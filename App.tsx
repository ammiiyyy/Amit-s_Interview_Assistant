import React from 'react';
import { useLiveSession } from './hooks/useLiveSession';
import AudioVisualizer from './components/AudioVisualizer';
import { ConnectionState } from './types';
import { Mic, MicOff, AlertCircle, Play, Square } from 'lucide-react';

const App: React.FC = () => {
  const { connect, disconnect, connectionState, error, analyser } = useLiveSession();

  const isConnected = connectionState === ConnectionState.CONNECTED;
  const isConnecting = connectionState === ConnectionState.CONNECTING;
  const isError = connectionState === ConnectionState.ERROR;

  const handleToggleConnection = () => {
    if (isConnected || isConnecting) {
      disconnect();
    } else {
      connect();
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-50 flex flex-col items-center p-4 sm:p-8">
      {/* Header */}
      <header className="w-full max-w-3xl mb-12 flex flex-col items-center text-center">
        <div className="bg-blue-600/20 p-4 rounded-full mb-6 ring-1 ring-blue-500/50 shadow-[0_0_30px_-5px_rgba(59,130,246,0.3)]">
           <Mic className="w-8 h-8 text-blue-400" />
        </div>
        <h1 className="text-4xl font-bold tracking-tight mb-3 bg-gradient-to-r from-blue-300 via-white to-blue-300 bg-clip-text text-transparent">
          AI Candidate Voice Bot
        </h1>
        <p className="text-slate-400 text-lg max-w-xl">
          A real-time voice interview simulation powered by Gemini 2.5 Live API. 
          Talk to me as if you are interviewing me for the Gen AI Engineer role.
        </p>
      </header>

      {/* Main Interface */}
      <main className="w-full max-w-3xl flex-grow flex flex-col items-center">
        
        {/* Visualizer Container */}
        <div className="w-full h-64 sm:h-80 bg-slate-800/50 rounded-2xl border border-slate-700 p-6 shadow-2xl mb-8 relative overflow-hidden backdrop-blur-sm">
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-slate-900/50 pointer-events-none" />
          
          <div className="relative z-10 w-full h-full flex flex-col justify-between">
            <div className="flex justify-between items-start">
               <div className="flex items-center space-x-2">
                 <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-slate-500'}`} />
                 <span className="text-xs font-mono uppercase tracking-wider text-slate-400">
                   {connectionState}
                 </span>
               </div>
               {isConnected && (
                 <span className="px-2 py-1 bg-blue-500/10 border border-blue-500/20 rounded text-xs text-blue-300">
                   gemini-2.5-flash-native
                 </span>
               )}
            </div>

            <div className="flex-grow flex items-center justify-center py-4">
              {isConnected ? (
                 <AudioVisualizer analyser={analyser} isListening={true} />
              ) : (
                <div className="text-slate-600 italic">
                  Press start to begin the interview simulation...
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-col items-center gap-6">
          <button
            onClick={handleToggleConnection}
            disabled={isConnecting}
            className={`
              relative group px-8 py-4 rounded-full font-semibold text-lg transition-all duration-300 transform active:scale-95 shadow-lg flex items-center space-x-3
              ${isConnected 
                ? 'bg-red-500/10 text-red-400 border-2 border-red-500/50 hover:bg-red-500/20 hover:border-red-500 hover:shadow-red-900/20' 
                : 'bg-blue-600 text-white hover:bg-blue-500 hover:shadow-blue-900/30'
              }
              ${isConnecting ? 'opacity-70 cursor-wait' : ''}
            `}
          >
            {isConnecting ? (
               <span className="flex items-center">
                 <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                   <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                   <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                 </svg>
                 Connecting...
               </span>
            ) : isConnected ? (
              <>
                <Square className="w-5 h-5 fill-current" />
                <span>End Interview</span>
              </>
            ) : (
              <>
                <Play className="w-5 h-5 fill-current" />
                <span>Start Interview</span>
              </>
            )}
          </button>
          
          {isError && (
             <div className="flex items-center text-red-400 bg-red-900/20 px-4 py-2 rounded-lg border border-red-900/50">
               <AlertCircle className="w-4 h-4 mr-2" />
               <p className="text-sm">{error}</p>
             </div>
          )}
        </div>
      </main>

      <footer className="w-full max-w-3xl mt-12 border-t border-slate-800 pt-6 text-center text-slate-500 text-sm">
        <p>Built for the 100x Gen AI Assessment</p>
      </footer>
    </div>
  );
};

export default App;
