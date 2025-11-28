import React, { useEffect, useRef } from 'react';
import { AudioVisualizerProps } from '../types';

const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ analyser, isListening }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    const bufferLength = analyser ? analyser.frequencyBinCount : 0;
    const dataArray = analyser ? new Uint8Array(bufferLength) : new Uint8Array(0);

    const draw = () => {
      animationId = requestAnimationFrame(draw);

      // Clear canvas
      ctx.fillStyle = '#0f172a'; // Match background
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (!analyser || !isListening) {
        // Draw a flat line or idle state
        ctx.beginPath();
        ctx.moveTo(0, canvas.height / 2);
        ctx.lineTo(canvas.width, canvas.height / 2);
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 2;
        ctx.stroke();
        return;
      }

      analyser.getByteFrequencyData(dataArray);

      const barWidth = (canvas.width / bufferLength) * 2.5;
      let barHeight;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i] / 1.5;

        // Gradient color for bars
        const gradient = ctx.createLinearGradient(0, canvas.height - barHeight, 0, canvas.height);
        gradient.addColorStop(0, '#60a5fa'); // Blue 400
        gradient.addColorStop(1, '#3b82f6'); // Blue 500

        ctx.fillStyle = gradient;
        
        // Center the visualization
        const y = (canvas.height - barHeight) / 2;
        
        // Draw rounded bars
        ctx.fillRect(x, y, barWidth, barHeight);

        x += barWidth + 1;
      }
    };

    draw();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [analyser, isListening]);

  return (
    <canvas
      ref={canvasRef}
      width={600}
      height={150}
      className="w-full h-full rounded-lg bg-slate-900 shadow-inner border border-slate-800"
    />
  );
};

export default AudioVisualizer;
