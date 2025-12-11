import { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { ConnectionState } from '../types';
import { SYSTEM_INSTRUCTION, MODEL_NAME } from '../constants';
import { createPcmBlob, decode, decodeAudioData } from '../utils/audio';

declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext;
  }
}

// AudioWorklet processor code
const WORKLET_CODE = `
class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096;
    this.buffer = new Float32Array(this.bufferSize);
    this.index = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const channelData = input[0];
      for (let i = 0; i < channelData.length; i++) {
        this.buffer[this.index++] = channelData[i];
        if (this.index >= this.bufferSize) {
          this.port.postMessage(this.buffer);
          this.index = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('recorder-processor', RecorderProcessor);
`;

export const useLiveSession = () => {
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [error, setError] = useState<string | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  // Audio Context and Nodes
  const inputContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const outputNodeRef = useRef<GainNode | null>(null);
  
  // Replaces scriptProcessorRef. Can be ScriptProcessorNode (fallback) or AudioWorkletNode
  const audioProcessingNodeRef = useRef<AudioNode | null>(null);
  const workletUrlRef = useRef<string | null>(null);
  
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  
  // Playback State
  const nextStartTimeRef = useRef<number>(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  // Session State
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const mountedRef = useRef(true);
  // Use a ref to track connection status synchronously for audio callbacks
  const connectedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      disconnect();
    };
  }, []);

  const disconnect = useCallback(() => {
    // Immediately set connected flag to false to stop processing incoming/outgoing data
    connectedRef.current = false;

    // 1. Stop Audio Sources & Processing first (Stop the data flow)
    audioSourcesRef.current.forEach(source => {
      try {
        source.stop();
      } catch (e) {
        // Ignore errors if already stopped
      }
    });
    audioSourcesRef.current.clear();

    if (audioProcessingNodeRef.current) {
      try {
        audioProcessingNodeRef.current.disconnect();
      } catch (e) {}
      audioProcessingNodeRef.current = null;
    }
    if (sourceRef.current) {
      try {
        sourceRef.current.disconnect();
      } catch (e) {}
      sourceRef.current = null;
    }

    // 2. Close Session
    if (sessionPromiseRef.current) {
        // Capture the promise and clear the ref immediately to prevent race conditions
        const currentPromise = sessionPromiseRef.current;
        sessionPromiseRef.current = null;
        
        currentPromise.then(session => {
            try {
                session.close();
            } catch (e) {
                console.warn("Error closing session:", e);
            }
        }).catch(() => {}); // Ignore errors from the promise itself
    }

    // Cleanup Worklet URL
    if (workletUrlRef.current) {
        URL.revokeObjectURL(workletUrlRef.current);
        workletUrlRef.current = null;
    }
    
    // 3. Close Contexts
    if (inputContextRef.current && inputContextRef.current.state !== 'closed') {
      inputContextRef.current.close().catch(() => {});
      inputContextRef.current = null;
    }
    if (outputContextRef.current && outputContextRef.current.state !== 'closed') {
      outputContextRef.current.close().catch(() => {});
      outputContextRef.current = null;
    }

    setConnectionState(ConnectionState.DISCONNECTED);
    setAnalyser(null);
  }, []);

  const connect = useCallback(async () => {
    try {
      // Ensure we start clean
      disconnect();
      
      setConnectionState(ConnectionState.CONNECTING);
      setError(null);

      // Initialize API
      const apiKey = process.env.API_KEY;
      if (!apiKey) {
        throw new Error("API Key not found in environment variables.");
      }
      const ai = new GoogleGenAI({ apiKey });

      // Initialize Audio Contexts
      // Use standard AudioContext if available, fallback to webkit only if necessary
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      
      // Allow the browser to choose the sample rate (usually 44100 or 48000)
      // This prevents issues where the hardware doesn't support 16000
      const inputCtx = new AudioContextClass();
      const outputCtx = new AudioContextClass({ sampleRate: 24000 });
      
      // Resume contexts immediately to ensure they are active (Chrome sometimes suspends them)
      await inputCtx.resume();
      await outputCtx.resume();

      inputContextRef.current = inputCtx;
      outputContextRef.current = outputCtx;

      // Setup Visualizer Analyser
      const visualizerAnalyser = outputCtx.createAnalyser();
      visualizerAnalyser.fftSize = 256;
      setAnalyser(visualizerAnalyser);

      // Setup Input Chain
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const source = inputCtx.createMediaStreamSource(stream);
      sourceRef.current = source;
      
      const outputNode = outputCtx.createGain();
      outputNode.connect(outputCtx.destination);
      outputNode.connect(visualizerAnalyser); 
      outputNodeRef.current = outputNode;

      // Start Session first to get the promise
      const sessionPromise = ai.live.connect({
        model: MODEL_NAME,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: SYSTEM_INSTRUCTION,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
        },
        callbacks: {
          onopen: () => {
            if (!mountedRef.current) return;
            console.log("Session Opened");
            setConnectionState(ConnectionState.CONNECTED);
            connectedRef.current = true;
          },
          onmessage: async (message: LiveServerMessage) => {
            if (!mountedRef.current || !connectedRef.current) return;

            // Handle Audio Output
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
               const ctx = outputContextRef.current;
               if (!ctx) return;

               // Ensure smooth scheduling
               nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);

               try {
                 const audioBuffer = await decodeAudioData(
                   decode(base64Audio),
                   ctx,
                   24000,
                   1
                 );

                 const bufferSource = ctx.createBufferSource();
                 bufferSource.buffer = audioBuffer;
                 bufferSource.connect(outputNodeRef.current!);
                 
                 bufferSource.addEventListener('ended', () => {
                     audioSourcesRef.current.delete(bufferSource);
                 });

                 bufferSource.start(nextStartTimeRef.current);
                 nextStartTimeRef.current += audioBuffer.duration;
                 audioSourcesRef.current.add(bufferSource);
               } catch (e) {
                 console.error("Error decoding audio:", e);
               }
            }

            // Handle Interruption
            const interrupted = message.serverContent?.interrupted;
            if (interrupted) {
              console.log("Interrupted!");
              audioSourcesRef.current.forEach(src => {
                  try { src.stop(); } catch(e) {}
              });
              audioSourcesRef.current.clear();
              nextStartTimeRef.current = 0;
            }
          },
          onclose: (event: CloseEvent) => {
             console.log("Session Closed", event.code, event.reason);
             if (mountedRef.current && connectedRef.current) {
                 // Only set to disconnected if we didn't initiate the disconnect ourselves
                 connectedRef.current = false;
                 setConnectionState(ConnectionState.DISCONNECTED);
             }
          },
          onerror: (e) => {
            console.error("Session Error", e);
            if (mountedRef.current && connectedRef.current) {
                connectedRef.current = false;
                const msg = e instanceof Error ? e.message : String(e);
                // If it's a network error, it might be transient or a hard disconnect
                setError(`Connection lost: ${msg}. Please try starting again.`);
                setConnectionState(ConnectionState.ERROR);
            }
          }
        }
      });
      sessionPromiseRef.current = sessionPromise;

      // Helper to send data with robust error handling
      const sendRealtimeInput = (data: Float32Array) => {
          // 1. First check: Do not proceed if we are already disconnected or have no session
          if (!connectedRef.current || !sessionPromiseRef.current) return;
          
          // USE THE ACTUAL SAMPLE RATE
          const sampleRate = inputContextRef.current?.sampleRate || 16000;
          const pcmBlob = createPcmBlob(data, sampleRate);
          
          // Capture promise at the moment of call
          const currentPromise = sessionPromiseRef.current;

          currentPromise.then(async (session) => {
            // 2. Second check: Ensure connection is still active before sending
            if (!connectedRef.current) return;
            
            try {
              // Await the send to ensure we catch both sync errors and promise rejections
              await session.sendRealtimeInput({ media: pcmBlob });
            } catch (e: any) {
              // 3. Graceful Error Handling
              // Completely suppress errors related to closing states. 
              // These are expected race conditions when the socket closes.
              const msg = e.message || '';
              if (msg.includes("CLOSING") || msg.includes("CLOSED")) {
                  // Do nothing, do not log.
                  return;
              }
              // Only log genuine unexpected errors
              console.error("Error sending input:", e);
            }
          }).catch(e => {
             // Suppress errors if we are already disconnected
             if (connectedRef.current) {
                 console.debug("Session promise failed:", e);
             }
          });
      };

      // Setup Audio Processing (Worklet or ScriptProcessor)
      let processorNode: AudioNode;

      // Check for AudioWorklet support using optional chaining/safe checks
      if (inputCtx.audioWorklet && typeof inputCtx.audioWorklet.addModule === 'function') {
          console.log("Using AudioWorklet for audio processing");
          try {
            const blob = new Blob([WORKLET_CODE], { type: 'text/javascript' });
            const workletUrl = URL.createObjectURL(blob);
            workletUrlRef.current = workletUrl;

            await inputCtx.audioWorklet.addModule(workletUrl);
            const workletNode = new AudioWorkletNode(inputCtx, 'recorder-processor');
            
            workletNode.port.onmessage = (e) => {
                sendRealtimeInput(e.data);
            };
            processorNode = workletNode;
          } catch (workletError) {
             console.error("AudioWorklet failed to initialize, falling back to ScriptProcessor", workletError);
             // Fallback logic duplicated here only if Worklet setup fails
             const scriptNode = inputCtx.createScriptProcessor(4096, 1, 1);
             scriptNode.onaudioprocess = (e) => {
                  const inputData = e.inputBuffer.getChannelData(0);
                  sendRealtimeInput(inputData);
             };
             processorNode = scriptNode;
          }
      } else {
          console.log("AudioWorklet not supported, using ScriptProcessor (fallback)");
          const scriptNode = inputCtx.createScriptProcessor(4096, 1, 1);
          scriptNode.onaudioprocess = (e) => {
               const inputData = e.inputBuffer.getChannelData(0);
               sendRealtimeInput(inputData);
          };
          processorNode = scriptNode;
      }

      audioProcessingNodeRef.current = processorNode;
      
      // Connect graph
      source.connect(processorNode);
      processorNode.connect(inputCtx.destination);

    } catch (err: any) {
      console.error(err);
      connectedRef.current = false;
      setError(err.message || "Failed to start session");
      setConnectionState(ConnectionState.ERROR);
      disconnect();
    }
  }, [disconnect]);

  return {
    connect,
    disconnect,
    connectionState,
    error,
    analyser
  };
};