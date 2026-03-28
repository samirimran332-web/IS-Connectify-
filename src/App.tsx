import React, { useState, useEffect, useRef, useMemo } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { 
  BookOpen, 
  Newspaper, 
  Image as ImageIcon, 
  Video, 
  Music, 
  Settings, 
  User, 
  LogOut, 
  Send, 
  Plus, 
  Sparkles,
  Search,
  MapPin,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Brain,
  MessageSquare,
  RefreshCw,
  Download,
  Play,
  Pause,
  Clock,
  ChevronRight,
  Menu,
  X,
  Github,
  Twitter,
  Globe,
  CheckCircle2,
  Circle,
  Trash2,
  Calendar,
  Camera,
  Paperclip,
  Copy,
  Share2,
  ExternalLink,
  MessageCircle,
  Filter,
  ArrowUpDown,
  Users,
  Users2,
  Lock,
  Unlock,
  FileText,
  Loader2,
  Waves
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Toaster, toast } from 'sonner';
import Markdown from 'react-markdown';
import { cn } from './lib/utils';
import { 
  auth, 
  db, 
  signInWithGoogle, 
  logout, 
  NewsItem,
  UserProfile as IUserProfile,
  updateProfile,
  Task
} from './firebase';
import { 
  onAuthStateChanged, 
  User as FirebaseUser 
} from 'firebase/auth';
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  updateDoc,
  deleteDoc,
  where,
  serverTimestamp,
  Timestamp,
  doc,
  getDoc,
  getDocs,
  setDoc
} from 'firebase/firestore';
import { 
  generateStudyHelp, 
  generateNews, 
  generateAutoNews,
  generateImage, 
  generateVideo, 
  getVideoResult,
  pollVideoOperation,
  generateMusic,
  MODELS
} from './lib/gemini';

// --- Types ---
type Tab = 'home' | 'study' | 'news' | 'media' | 'tasks' | 'settings' | 'profile' | 'groups';

// --- Live Voice Chat Component ---

const LiveVoiceChat = ({ isOpen, onClose, customKey }: { isOpen: boolean, onClose: () => void, customKey?: string }) => {
  const [isActive, setIsActive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [transcription, setTranscription] = useState("");
  const [aiTranscription, setAiTranscription] = useState("");
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  
  const sessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioQueue = useRef<Int16Array[]>([]);
  const isPlaying = useRef(false);

  const stopSession = () => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setIsActive(false);
    setIsConnecting(false);
    setTranscription("");
    setAiTranscription("");
    audioQueue.current = [];
    isPlaying.current = false;
  };

  const startSession = async () => {
    // Check for custom key or platform key
    let apiKey = customKey || process.env.GEMINI_API_KEY;
    
    // For Live API, we strongly recommend a paid key
    const hasPlatformKey = await (window as any).aistudio?.hasSelectedApiKey();
    
    if (!apiKey && !hasPlatformKey) {
      const wantToSelect = confirm("Live Voice Chat requires a Gemini API key. Would you like to select one from your Google Cloud project?");
      if (wantToSelect) {
        await (window as any).aistudio?.openSelectKey();
        // After opening, we assume success and try to proceed
      } else {
        return;
      }
    }

    setIsConnecting(true);
    setTranscription("");
    setAiTranscription("");

    try {
      // Always create a fresh instance to get the latest key
      const ai = new GoogleGenAI({ apiKey: customKey || process.env.GEMINI_API_KEY! });
      
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioContextRef.current = audioContext;
      
      // Ensure context is resumed (browsers often start it as suspended)
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      
      const session = await ai.live.connect({
        model: MODELS.LIVE,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
          },
          systemInstruction: "You are a polite and helpful female AI assistant named IS Connectify. Always maintain a respectful and professional tone. Keep your responses concise and conversational. You are speaking in real-time.",
        },
        callbacks: {
          onopen: async () => {
            setIsConnecting(false);
            setIsActive(true);
            toast.success("Live connection established!");
            
            // Start microphone
            try {
              const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
              streamRef.current = stream;
              sourceRef.current = audioContextRef.current!.createMediaStreamSource(stream);
              processorRef.current = audioContextRef.current!.createScriptProcessor(4096, 1, 1);
              
              processorRef.current.onaudioprocess = (e) => {
                if (isMuted || !sessionRef.current) return;
                const inputData = e.inputBuffer.getChannelData(0);
                const pcmData = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                  pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
                }
                
                // Convert to base64 more efficiently
                const uint8 = new Uint8Array(pcmData.buffer);
                let binary = '';
                for (let i = 0; i < uint8.length; i++) {
                  binary += String.fromCharCode(uint8[i]);
                }
                const base64Data = btoa(binary);

                try {
                  sessionRef.current.sendRealtimeInput({
                    audio: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
                  });
                } catch (sendErr) {
                  console.error("Failed to send audio:", sendErr);
                }
              };
              
              sourceRef.current.connect(processorRef.current);
              processorRef.current.connect(audioContextRef.current!.destination);
            } catch (err) {
              toast.error("Microphone access denied.");
              stopSession();
            }
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle Audio
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
              try {
                const binary = atob(base64Audio);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) {
                  bytes[i] = binary.charCodeAt(i);
                }
                const pcmData = new Int16Array(bytes.buffer);
                audioQueue.current.push(pcmData);
                if (!isPlaying.current) playNextInQueue();
              } catch (decodeErr) {
                console.error("Audio decoding error:", decodeErr);
              }
            }

            // Handle Interruption
            if (message.serverContent?.interrupted) {
              audioQueue.current = [];
              isPlaying.current = false;
            }
          },
          onclose: () => {
            setIsActive(false);
            setIsConnecting(false);
            stopSession();
          },
          onerror: (err) => {
            console.error("Live Error Detail:", err);
            const errMsg = err instanceof Error ? err.message : String(err);
            
            if (errMsg.includes("Network error") || errMsg.includes("403") || errMsg.includes("not found")) {
              toast.error("Connection failed. This model often requires a paid Gemini API key.");
              // Reset key selection if it failed
              if (!customKey) {
                (window as any).aistudio?.openSelectKey();
              }
            } else {
              toast.error(`Connection error: ${errMsg}`);
            }
            stopSession();
          }
        }
      });
      
      sessionRef.current = session;
    } catch (err) {
      console.error("Failed to connect:", err);
      const errMsg = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to start live session: ${errMsg}`);
      setIsConnecting(false);
    }
  };

  const playNextInQueue = async () => {
    if (audioQueue.current.length === 0 || !audioContextRef.current) {
      isPlaying.current = false;
      return;
    }

    // Ensure context is active before playing
    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }

    isPlaying.current = true;
    const pcmData = audioQueue.current.shift()!;
    const audioBuffer = audioContextRef.current.createBuffer(1, pcmData.length, 16000);
    const channelData = audioBuffer.getChannelData(0);
    for (let i = 0; i < pcmData.length; i++) {
      channelData[i] = pcmData[i] / 0x7FFF;
    }

    const source = audioContextRef.current.createBufferSource();
    source.buffer = audioBuffer;
    
    const gainNode = audioContextRef.current.createGain();
    gainNode.gain.value = volume;
    
    source.connect(gainNode);
    gainNode.connect(audioContextRef.current.destination);
    
    source.onended = () => {
      if (audioContextRef.current) {
        playNextInQueue();
      }
    };
    source.start();
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.95 }}
        className="fixed bottom-24 right-6 w-80 bg-white/90 backdrop-blur-xl border border-white/20 rounded-3xl shadow-2xl z-50 overflow-hidden"
      >
        <div className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center transition-all duration-500",
                isActive ? "bg-green-100 text-green-600 animate-pulse" : "bg-indigo-100 text-indigo-600"
              )}>
                <Waves className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-800">Live AI Voice</h3>
                <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">
                  {isActive ? "Connected" : isConnecting ? "Connecting..." : "Offline"}
                </p>
              </div>
            </div>
            <button 
              onClick={onClose}
              className="p-2 hover:bg-slate-100 rounded-full transition-colors"
            >
              <X className="w-5 h-5 text-slate-400" />
            </button>
          </div>

          <div className="h-32 flex flex-col items-center justify-center space-y-4 bg-slate-50/50 rounded-2xl border border-slate-100 p-4">
            {isActive ? (
              <div className="flex items-center gap-1 h-8">
                {[...Array(8)].map((_, i) => (
                  <motion.div
                    key={i}
                    animate={{ 
                      height: isMuted ? 4 : [8, 24, 12, 32, 8],
                    }}
                    transition={{ 
                      repeat: Infinity, 
                      duration: 0.8, 
                      delay: i * 0.1,
                      ease: "easeInOut"
                    }}
                    className="w-1.5 bg-indigo-500 rounded-full"
                  />
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400 text-center italic">
                {isConnecting ? "Establishing secure connection..." : "Start a real-time voice conversation with IS Connectify AI."}
              </p>
            )}
          </div>

          <div className="flex items-center justify-center gap-4">
            <button
              onClick={isActive ? stopSession : startSession}
              disabled={isConnecting}
              className={cn(
                "w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300 shadow-lg active:scale-90",
                isActive 
                  ? "bg-red-500 text-white hover:bg-red-600" 
                  : "bg-indigo-600 text-white hover:bg-indigo-700"
              )}
            >
              {isConnecting ? (
                <Loader2 className="w-8 h-8 animate-spin" />
              ) : isActive ? (
                <MicOff className="w-8 h-8" />
              ) : (
                <Mic className="w-8 h-8" />
              )}
            </button>
          </div>

          <div className="flex items-center justify-between pt-2">
            <button 
              onClick={() => setIsMuted(!isMuted)}
              className="p-2 text-slate-400 hover:text-indigo-600 transition-colors"
            >
              {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
            <div className="flex items-center gap-2 flex-1 mx-4">
              <Volume2 className="w-4 h-4 text-slate-400" />
              <input 
                type="range" 
                min="0" 
                max="1" 
                step="0.1" 
                value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className="flex-1 h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
              />
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

// --- Components ---

const Button = ({ className, variant = 'primary', size = 'md', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger', size?: 'sm' | 'md' | 'lg' | 'icon' }) => {
  const variants = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm',
    secondary: 'bg-slate-800 text-white hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600',
    outline: 'border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800',
    ghost: 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800',
    danger: 'bg-red-500 text-white hover:bg-red-600'
  };
  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
    icon: 'p-2'
  };
  return (
    <button 
      className={cn('rounded-lg font-medium transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2', variants[variant], sizes[size], className)} 
      {...props} 
    />
  );
};

const Card = ({ children, className }: { children: React.ReactNode, className?: string }) => (
  <div className={cn('bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden transition-colors', className)}>
    {children}
  </div>
);

const Input = ({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input className={cn('w-full px-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all dark:text-slate-50', className)} {...props} />
);

const TextArea = ({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea className={cn('w-full px-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all dark:text-slate-50 resize-none', className)} {...props} />
);

// --- Main App ---

function WelcomeModal({ onClose }: { onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md"
    >
      <motion.div
        initial={{ scale: 0.8, opacity: 0, y: 40 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.8, opacity: 0, y: 40 }}
        transition={{ type: "spring", damping: 25, stiffness: 200 }}
        className="relative max-w-lg w-full bg-[#0a0a0a] border border-white/10 rounded-[48px] p-12 text-center overflow-hidden shadow-[0_0_100px_rgba(99,102,241,0.2)]"
      >
        {/* Background Glows */}
        <div className="absolute -top-32 -left-32 w-96 h-96 bg-indigo-600/20 blur-[120px] rounded-full animate-pulse" />
        <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-purple-600/20 blur-[120px] rounded-full animate-pulse" style={{ animationDelay: '1s' }} />
        
        {/* Floating Orbs */}
        <motion.div 
          animate={{ 
            y: [0, -20, 0],
            rotate: [0, 10, 0]
          }}
          transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-10 right-10 w-20 h-20 bg-gradient-to-br from-indigo-500/10 to-purple-500/10 rounded-full border border-white/5 backdrop-blur-3xl"
        />

        <div className="relative z-10 space-y-10">
          <motion.div 
            initial={{ rotate: -20, scale: 0.5 }}
            animate={{ rotate: 0, scale: 1 }}
            transition={{ delay: 0.2, type: "spring" }}
            className="inline-flex items-center justify-center w-24 h-24 rounded-[32px] bg-white/5 border border-white/10 backdrop-blur-2xl mb-2"
          >
            <Sparkles className="w-12 h-12 text-indigo-400" />
          </motion.div>
          
          <div className="space-y-6">
            <div className="relative">
              <h2 className="text-5xl md:text-7xl font-black uppercase tracking-tighter font-display text-white leading-[0.85]">
                Welcome to <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-b from-white via-white to-white/10">
                  IS Connectify
                </span>
              </h2>
              <motion.div 
                animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.8, 0.5] }}
                transition={{ duration: 4, repeat: Infinity }}
                className="absolute -top-10 -right-10 w-32 h-32 bg-indigo-500/20 rounded-full blur-3xl" 
              />
            </div>
            <p className="text-slate-400 text-xl font-light leading-relaxed tracking-tight">
              Your intelligent ecosystem for learning, news, and creativity. 
              Step into the future of connectivity.
            </p>
          </div>

          <Button 
            onClick={onClose}
            className="w-full py-10 text-3xl rounded-[32px] bg-white text-black hover:bg-indigo-600 hover:text-white transition-all duration-700 font-black uppercase tracking-[0.2em] shadow-[0_20px_40px_rgba(255,255,255,0.1)] group relative overflow-hidden"
          >
            <motion.div
              className="absolute inset-0 bg-gradient-to-r from-indigo-600 to-purple-600 opacity-0 group-hover:opacity-100 transition-opacity duration-700"
            />
            <span className="relative z-10 flex items-center justify-center gap-3">
              Get Started
              <ChevronRight className="w-8 h-8 group-hover:translate-x-2 transition-transform" />
            </span>
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [customApiKey, setCustomApiKey] = useState('');
  const [showWelcome, setShowWelcome] = useState(true);
  const [isLiveChatOpen, setIsLiveChatOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('theme') as 'light' | 'dark') || 'light';
    }
    return 'light';
  });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const handleLogin = async () => {
    try {
      await signInWithGoogle();
      toast.success('Successfully logged in!');
    } catch (err) {
      toast.error('Failed to login');
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      toast.success('Logged out');
    } catch (err) {
      toast.error('Failed to logout');
    }
  };

  return (
    <div className={cn(
      "min-h-screen font-sans transition-colors duration-300",
      theme === 'dark' ? "bg-slate-950 text-slate-50" : "bg-slate-50 text-slate-900"
    )}>
      <AnimatePresence>
        {showWelcome && <WelcomeModal onClose={() => setShowWelcome(false)} />}
      </AnimatePresence>
      {/* Floating Live Voice Chat Button */}
      <motion.button
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        onClick={() => setIsLiveChatOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-indigo-600 text-white rounded-full flex items-center justify-center shadow-2xl z-40 hover:bg-indigo-700 transition-colors group"
      >
        <div className="absolute -top-12 right-0 bg-slate-900 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none font-bold uppercase tracking-widest">
          Live Voice Chat
        </div>
        <Mic className="w-6 h-6" />
        <motion.div
          animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="absolute inset-0 bg-indigo-400 rounded-full -z-10"
        />
      </motion.button>

      <LiveVoiceChat 
        isOpen={isLiveChatOpen} 
        onClose={() => setIsLiveChatOpen(false)} 
        customKey={customApiKey}
      />

      <Toaster position="top-center" />
      
      {/* Mobile Header */}
      <header className={cn(
        "lg:hidden h-16 border-b flex items-center justify-between px-4 sticky top-0 z-50 transition-colors",
        theme === 'dark' ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"
      )}>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <Sparkles className="text-white w-5 h-5" />
          </div>
          <span className="font-bold text-lg tracking-tight">IS Connectify</span>
        </div>
        <button onClick={() => setIsSidebarOpen(true)} className="p-2 hover:bg-slate-100 rounded-lg">
          <Menu className="w-6 h-6" />
        </button>
      </header>

      {/* Sidebar */}
      <AnimatePresence>
        {(isSidebarOpen || window.innerWidth >= 1024) && (
          <motion.aside 
            initial={{ x: -300 }}
            animate={{ x: 0 }}
            exit={{ x: -300 }}
            className={cn(
              "fixed inset-y-0 left-0 w-72 border-r z-50 flex flex-col transition-colors",
              theme === 'dark' ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200",
              !isSidebarOpen && "hidden lg:flex"
            )}
          >
            <div className="p-6 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-200">
                  <Sparkles className="text-white w-6 h-6" />
                </div>
                <div>
                  <h1 className="font-bold text-xl tracking-tight">IS Connectify</h1>
                  <p className={cn(
                    "text-[10px] uppercase tracking-widest font-semibold",
                    theme === 'dark' ? "text-slate-500" : "text-slate-400"
                  )}>AI Platform</p>
                </div>
              </div>
              <button onClick={() => setIsSidebarOpen(false)} className={cn(
                "lg:hidden p-2 rounded-lg transition-colors",
                theme === 'dark' ? "hover:bg-slate-800" : "hover:bg-slate-100"
              )}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <nav className="flex-1 px-4 py-4 space-y-1">
              <NavItem icon={<Globe />} label="Home" active={activeTab === 'home'} theme={theme} onClick={() => { setActiveTab('home'); setIsSidebarOpen(false); }} />
              <NavItem icon={<BookOpen />} label="Study Help" active={activeTab === 'study'} theme={theme} onClick={() => { setActiveTab('study'); setIsSidebarOpen(false); }} />
              <NavItem icon={<Newspaper />} label="News Feed" active={activeTab === 'news'} theme={theme} onClick={() => { setActiveTab('news'); setIsSidebarOpen(false); }} />
              <NavItem icon={<CheckCircle2 />} label="Study Tasks" active={activeTab === 'tasks'} theme={theme} onClick={() => { setActiveTab('tasks'); setIsSidebarOpen(false); }} />
              <NavItem icon={<Users />} label="Study Groups" active={activeTab === 'groups'} theme={theme} onClick={() => { setActiveTab('groups'); setIsSidebarOpen(false); }} />
              <NavItem icon={<Sparkles />} label="AI Studio" active={activeTab === 'media'} theme={theme} onClick={() => { setActiveTab('media'); setIsSidebarOpen(false); }} />
              <NavItem icon={<Mic />} label="Live Voice Chat" active={isLiveChatOpen} theme={theme} onClick={() => { setIsLiveChatOpen(true); setIsSidebarOpen(false); }} />
              <NavItem icon={<User />} label="Profile" active={activeTab === 'profile'} theme={theme} onClick={() => { setActiveTab('profile'); setIsSidebarOpen(false); }} />
              <NavItem icon={<Settings />} label="Settings" active={activeTab === 'settings'} theme={theme} onClick={() => { setActiveTab('settings'); setIsSidebarOpen(false); }} />
              <NavItem 
                icon={<MessageCircle />} 
                label="Support" 
                active={false} 
                theme={theme}
                onClick={() => { 
                  window.open('https://wa.me/8801616520248', '_blank');
                  setIsSidebarOpen(false); 
                }} 
              />
            </nav>

            <div className={cn(
              "p-4 border-t transition-colors",
              theme === 'dark' ? "border-slate-800" : "border-slate-100"
            )}>
              {user ? (
                <div className={cn(
                  "flex items-center gap-3 p-3 rounded-xl transition-colors",
                  theme === 'dark' ? "bg-slate-800" : "bg-slate-50"
                )}>
                  <img src={user.photoURL || ''} alt="" className="w-10 h-10 rounded-full border-2 border-white shadow-sm" referrerPolicy="no-referrer" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{user.displayName}</p>
                    <p className={cn(
                      "text-xs truncate",
                      theme === 'dark' ? "text-slate-400" : "text-slate-500"
                    )}>{user.email}</p>
                  </div>
                  <button onClick={handleLogout} className={cn(
                    "p-2 transition-colors",
                    theme === 'dark' ? "text-slate-500 hover:text-red-400" : "text-slate-400 hover:text-red-500"
                  )}>
                    <LogOut className="w-5 h-5" />
                  </button>
                </div>
              ) : (
                <Button onClick={handleLogin} className="w-full">
                  <User className="w-4 h-4" />
                  Sign In with Google
                </Button>
              )}
            </div>
            
            <div className="p-4 text-center">
              <p className={cn(
                "text-[10px] font-medium",
                theme === 'dark' ? "text-slate-600" : "text-slate-400"
              )}>Create by Imran Samir</p>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="lg:ml-72 min-h-screen p-4 lg:p-8">
        <div className="max-w-5xl mx-auto">
          <AnimatePresence mode="wait">
            {activeTab === 'home' && <HomeView key="home" onStart={() => setActiveTab('study')} />}
            {activeTab === 'study' && <StudyView key="study" user={user} customApiKey={customApiKey} />}
            {activeTab === 'news' && <NewsView key="news" user={user} customApiKey={customApiKey} />}
            {activeTab === 'tasks' && <TasksView key="tasks" user={user} />}
            {activeTab === 'groups' && <StudyGroupsView key="groups" user={user} />}
            {activeTab === 'media' && <MediaView key="media" customApiKey={customApiKey} />}
            {activeTab === 'profile' && <UserProfile key="profile" user={user} />}
            {activeTab === 'settings' && <SettingsView key="settings" apiKey={customApiKey} setApiKey={setCustomApiKey} theme={theme} setTheme={setTheme} />}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

function NavItem({ icon, label, active, onClick, theme }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void, theme?: 'light' | 'dark' }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200",
        active 
          ? (theme === 'dark' ? "bg-indigo-500/10 text-indigo-400 font-semibold shadow-sm" : "bg-indigo-50 text-indigo-600 font-semibold shadow-sm")
          : (theme === 'dark' ? "text-slate-400 hover:bg-slate-800 hover:text-slate-100" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900")
      )}
    >
      <span className={cn("w-5 h-5", active ? (theme === 'dark' ? "text-indigo-400" : "text-indigo-600") : "text-slate-400")}>{icon}</span>
      <span className="text-sm">{label}</span>
      {active && <motion.div layoutId="active-nav" className={cn("ml-auto w-1.5 h-1.5 rounded-full", theme === 'dark' ? "bg-indigo-400" : "bg-indigo-600")} />}
    </button>
  );
}

// --- Views ---

function HomeView({ onStart }: { onStart: () => void }) {
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const [isHovering, setIsHovering] = useState(false);

  useEffect(() => {
    const moveCursor = (e: MouseEvent) => {
      setCursorPos({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener('mousemove', moveCursor);
    return () => window.removeEventListener('mousemove', moveCursor);
  }, []);

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="min-h-screen flex flex-col bg-[#050505] text-white -mx-4 -mt-8 px-4 pt-8 overflow-hidden font-sans selection:bg-indigo-500/30 cursor-none"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      {/* Custom Spotlight Cursor */}
      <motion.div 
        className="fixed top-0 left-0 w-8 h-8 bg-white rounded-full mix-blend-difference pointer-events-none z-[9999] hidden md:block"
        animate={{ 
          x: cursorPos.x - 16, 
          y: cursorPos.y - 16,
          scale: isHovering ? 1 : 0
        }}
        transition={{ type: "spring", damping: 30, stiffness: 250, mass: 0.5 }}
      />
      <motion.div 
        className="fixed top-0 left-0 w-64 h-64 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none z-[9998] hidden md:block"
        animate={{ 
          x: cursorPos.x - 128, 
          y: cursorPos.y - 128,
          scale: isHovering ? 1 : 0
        }}
        transition={{ type: "spring", damping: 40, stiffness: 150, mass: 0.8 }}
      />

      {/* Immersive Background with Floating Particles */}
      <div className="absolute inset-0 overflow-hidden -z-10 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[70%] h-[70%] bg-indigo-600/10 blur-[160px] rounded-full animate-pulse" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[70%] h-[70%] bg-purple-600/10 blur-[160px] rounded-full animate-pulse" style={{ animationDelay: '2s' }} />
        
        {/* Floating Particles */}
        {[...Array(30)].map((_, i) => (
          <motion.div
            key={i}
            initial={{ 
              x: Math.random() * 100 + "%", 
              y: Math.random() * 100 + "%",
              opacity: Math.random() * 0.5,
              scale: Math.random() * 0.5 + 0.5
            }}
            animate={{ 
              y: [null, "-30%"],
              opacity: [null, 0]
            }}
            transition={{ 
              duration: Math.random() * 15 + 15, 
              repeat: Infinity, 
              ease: "linear",
              delay: Math.random() * 10
            }}
            className="absolute w-1 h-1 bg-white rounded-full"
          />
        ))}

        {/* Subtle Grid Overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:60px_60px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]" />
      </div>

      <main className="flex-1 flex flex-col items-center justify-center max-w-7xl mx-auto w-full py-20 lg:py-32 z-10">
        {/* Hero Section */}
        <div className="text-center space-y-16 mb-40">
          <motion.div 
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="inline-flex items-center gap-2 px-6 py-2 bg-white/5 border border-white/10 rounded-full text-[10px] font-bold uppercase tracking-[0.5em] text-indigo-400 backdrop-blur-xl"
          >
            <Sparkles className="w-4 h-4" />
            Intelligence Redefined
          </motion.div>
          
          <div className="space-y-10">
            <motion.h1 
              initial={{ y: 50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.3, type: "spring", stiffness: 50 }}
              className="text-4xl sm:text-7xl md:text-[120px] lg:text-[220px] font-black tracking-tighter leading-[0.9] md:leading-[0.7] uppercase font-display"
            >
              <span className="block mb-2 md:mb-0">IS</span>
              <span className="text-transparent bg-clip-text bg-gradient-to-b from-white via-white to-white/5 block md:inline">
                CONNECTIFY
              </span>
            </motion.h1>
            
            <motion.p 
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="text-base md:text-3xl text-slate-400 max-w-4xl mx-auto leading-relaxed font-light tracking-tight px-4"
            >
              The ultimate ecosystem for modern minds. 
              Bridging the gap between <span className="text-white font-normal underline decoration-indigo-500 underline-offset-8">learning</span>, <span className="text-white font-normal underline decoration-purple-500 underline-offset-8">news</span>, and <span className="text-white font-normal underline decoration-pink-500 underline-offset-8">creativity</span>.
            </motion.p>
          </div>

          <motion.div 
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="flex flex-wrap justify-center gap-6 sm:gap-10"
          >
            <Button 
              onClick={onStart} 
              className="px-8 py-6 text-lg sm:px-14 sm:py-10 sm:text-3xl rounded-full bg-white text-black hover:bg-indigo-600 hover:text-white transition-all duration-700 group relative overflow-hidden shadow-[0_0_60px_rgba(255,255,255,0.15)]"
            >
              <span className="relative z-10 flex items-center gap-4 font-black uppercase tracking-widest">
                Launch App
                <ChevronRight className="w-5 h-5 sm:w-8 sm:h-8 group-hover:translate-x-3 transition-transform" />
              </span>
            </Button>
            <Button 
              variant="outline" 
              className="px-8 py-6 text-lg sm:px-14 sm:py-10 sm:text-3xl rounded-full border-white/20 hover:bg-white/5 text-white backdrop-blur-md transition-all duration-500 uppercase tracking-[0.2em] font-black"
            >
              Explore
            </Button>
          </motion.div>
        </div>

        {/* Bento Grid Features */}
        <div className="grid grid-cols-1 md:grid-cols-4 md:grid-rows-2 gap-8 w-full px-6">
          <motion.div 
            initial={{ opacity: 0, y: 60 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="md:col-span-2 md:row-span-2"
          >
            <BentoCard 
              icon={<Brain className="w-16 h-16" />} 
              title="Smart Study AI" 
              desc="Personalized learning paths that adapt to your unique pace and style. Master any subject with AI guidance."
              color="from-indigo-600/40 to-blue-600/40"
              large
            />
          </motion.div>
          
          <motion.div 
            initial={{ opacity: 0, y: 60 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="md:col-span-2"
          >
            <BentoCard 
              icon={<Newspaper className="w-12 h-12" />} 
              title="Global News Stream" 
              desc="Real-time, verified updates from across the globe."
              color="from-purple-600/40 to-pink-600/40"
            />
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, y: 60 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
          >
            <BentoCard 
              icon={<ImageIcon className="w-12 h-12" />} 
              title="Image Gen" 
              desc="Pro-grade visuals."
              color="from-orange-600/40 to-red-600/40"
            />
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, y: 60 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3 }}
          >
            <BentoCard 
              icon={<Users className="w-12 h-12" />} 
              title="Study Groups" 
              desc="Collaborate live."
              color="from-emerald-600/40 to-teal-600/40"
            />
          </motion.div>
        </div>
      </main>

      {/* Marquee Section */}
      <div className="w-full py-16 border-y border-white/5 bg-white/[0.01] overflow-hidden mt-20">
        <div className="flex whitespace-nowrap animate-marquee">
          {[...Array(10)].map((_, i) => (
            <div key={i} className="flex items-center gap-12 mx-12 text-4xl font-black uppercase tracking-tighter opacity-10">
              <span>Intelligent</span>
              <Sparkles className="w-6 h-6 text-indigo-500" />
              <span>Connected</span>
              <Sparkles className="w-6 h-6 text-purple-500" />
              <span>Creative</span>
              <Sparkles className="w-6 h-6 text-pink-500" />
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <footer className="py-20 flex flex-col items-center gap-10 border-t border-white/5 bg-black/50 backdrop-blur-xl">
        <div className="flex gap-16 text-slate-500">
          <Twitter className="w-6 h-6 hover:text-white cursor-pointer transition-all duration-300 hover:scale-125" />
          <Github className="w-6 h-6 hover:text-white cursor-pointer transition-all duration-300 hover:scale-125" />
          <Globe className="w-6 h-6 hover:text-white cursor-pointer transition-all duration-300 hover:scale-125" />
        </div>
        <div className="text-center space-y-3">
          <div className="text-[12px] font-black uppercase tracking-[0.6em] text-slate-400">IS Connectify</div>
          <div className="text-[10px] text-slate-600 uppercase tracking-widest">
            Engineered by <span className="text-indigo-400 font-bold">Imran Samir</span> • v1.0
          </div>
        </div>
      </footer>

      <style>{`
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .animate-marquee {
          animation: marquee 40s linear infinite;
          width: fit-content;
        }
      `}</style>
    </motion.div>
  );
}

function BentoCard({ icon, title, desc, color, large = false }: { icon: React.ReactNode, title: string, desc: string, color: string, large?: boolean }) {
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [rotate, setRotate] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setMousePos({ x, y });

    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const rotateX = (y - centerY) / 20;
    const rotateY = (centerX - x) / 20;
    setRotate({ x: rotateX, y: rotateY });
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setRotate({ x: 0, y: 0 });
  };

  return (
    <motion.div 
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={handleMouseLeave}
      animate={{ 
        rotateX: rotate.x, 
        rotateY: rotate.y,
        scale: isHovered ? 1.02 : 1
      }}
      transition={{ type: "spring", damping: 20, stiffness: 150 }}
      style={{ transformStyle: "preserve-3d" }}
      className={cn(
        "relative h-full rounded-[48px] border border-white/5 bg-white/[0.02] p-12 overflow-hidden group transition-all duration-700 hover:bg-white/[0.05] hover:border-white/20",
        large ? "min-h-[500px]" : "min-h-[240px]"
      )}
    >
      {/* Spotlight Effect */}
      <div 
        className="absolute inset-0 pointer-events-none transition-opacity duration-500"
        style={{
          opacity: isHovered ? 1 : 0,
          background: `radial-gradient(800px circle at ${mousePos.x}px ${mousePos.y}px, rgba(255,255,255,0.08), transparent 40%)`
        }}
      />

      {/* Background Glow */}
      <div className={cn("absolute inset-0 bg-gradient-to-br opacity-0 group-hover:opacity-100 transition-opacity duration-700 -z-10", color)} />
      
      {/* Animated Border Gradient */}
      <motion.div 
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none"
        style={{
          background: `conic-gradient(from ${isHovered ? '0deg' : '360deg'} at 50% 50%, transparent, rgba(255,255,255,0.1), transparent)`
        }}
      />
      
      <div className="h-full flex flex-col justify-between relative z-10" style={{ transform: "translateZ(50px)" }}>
        <div className={cn(
          "rounded-[32px] flex items-center justify-center text-white shadow-2xl transition-all duration-700 group-hover:scale-110 group-hover:rotate-12",
          large ? "w-28 h-28" : "w-20 h-20",
          "bg-white/5 border border-white/10 backdrop-blur-2xl"
        )}>
          {icon}
        </div>
        
        <div className="space-y-6">
          <h3 className={cn("font-black uppercase tracking-tighter font-display transition-all duration-500 group-hover:translate-x-2", large ? "text-5xl" : "text-3xl")}>{title}</h3>
          <p className={cn("text-slate-400 font-light leading-relaxed transition-all duration-500 group-hover:translate-x-2 delay-75", large ? "text-2xl max-w-lg" : "text-lg")}>{desc}</p>
          <div className="w-16 h-1.5 bg-white/10 group-hover:w-full transition-all duration-700 ease-in-out rounded-full" />
        </div>
      </div>
    </motion.div>
  );
}

function StudyView({ user, customApiKey }: { user: FirebaseUser | null, customApiKey: string }) {
  const [messages, setMessages] = useState<{ role: 'user' | 'ai', content: string }[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<IUserProfile | null>(null);
  const [sessions, setSessions] = useState<{ id: string, title: string, createdAt: any }[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<{ data: string, mimeType: string, name: string }[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedMessageIndex, setSelectedMessageIndex] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;
    const unsubscribe = onSnapshot(doc(db, 'users', user.uid), (snap) => {
      if (snap.exists()) setProfile(snap.data() as IUserProfile);
    });
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'study_sessions'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );
    const unsubscribe = onSnapshot(q, (snap) => {
      setSessions(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)));
    });
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const startNewChat = () => {
    setCurrentSessionId(null);
    setMessages([]);
    setInput('');
  };

  const loadSession = (session: any) => {
    setCurrentSessionId(session.id);
    setMessages(session.messages);
    setShowHistory(false);
  };

  const deleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    try {
      await deleteDoc(doc(db, 'study_sessions', sessionId));
      if (currentSessionId === sessionId) {
        startNewChat();
      }
      toast.success('Session deleted');
    } catch (err) {
      toast.error('Failed to delete session');
    }
  };

  const clearAllHistory = async () => {
    if (!user || sessions.length === 0) return;
    
    try {
      const { writeBatch, doc } = await import('firebase/firestore');
      const batch = writeBatch(db);
      sessions.forEach(session => {
        batch.delete(doc(db, 'study_sessions', session.id));
      });
      await batch.commit();
      startNewChat();
      toast.success('All history cleared');
    } catch (err) {
      toast.error('Failed to clear history');
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const base64 = (ev.target?.result as string).split(',')[1];
        setAttachedFiles(prev => [...prev, { 
          data: base64, 
          mimeType: file.type, 
          name: file.name 
        }]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeFile = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const copyMessage = (content: string) => {
    navigator.clipboard.writeText(content);
    toast.success('Copied to clipboard');
  };

  const deleteMessage = async (index: number) => {
    if (!currentSessionId || !confirm('Delete this message?')) return;
    const newMessages = messages.filter((_, i) => i !== index);
    setMessages(newMessages);
    try {
      await updateDoc(doc(db, 'study_sessions', currentSessionId), {
        messages: newMessages,
        updatedAt: serverTimestamp()
      });
      toast.success('Message deleted');
    } catch (err) {
      toast.error('Failed to update session');
    }
  };

  const handleSend = async () => {
    if ((!input.trim() && attachedFiles.length === 0) || loading || !user) return;
    
    const userMsg = input;
    const currentFiles = [...attachedFiles];
    const newMessages = [...messages, { role: 'user' as const, content: userMsg }];
    setInput('');
    setAttachedFiles([]);
    setMessages(newMessages);
    setLoading(true);

    try {
      const response = await generateStudyHelp(userMsg, messages, {
        customKey: customApiKey,
        studentClass: profile?.studentClass,
        department: profile?.department,
        files: currentFiles.map(f => ({ data: f.data, mimeType: f.mimeType }))
      });
      
      const finalMessages = [...newMessages, { role: 'ai' as const, content: response }];
      setMessages(finalMessages);

      if (currentSessionId) {
        await updateDoc(doc(db, 'study_sessions', currentSessionId), {
          messages: finalMessages,
          updatedAt: serverTimestamp()
        });
      } else {
        const title = userMsg.slice(0, 30) + (userMsg.length > 30 ? '...' : '');
        const docRef = await addDoc(collection(db, 'study_sessions'), {
          userId: user.uid,
          title,
          messages: finalMessages,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        setCurrentSessionId(docRef.id);
      }
    } catch (err) {
      toast.error('Failed to get AI response. Check your API key.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col h-[calc(100vh-8rem)]"
    >
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <BookOpen className="text-indigo-600" />
            Study Assistant
          </h2>
          <p className="text-slate-500 text-sm">Ask anything about your studies, from math to literature.</p>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            size="icon" 
            className="md:hidden"
            onClick={() => setShowHistory(!showHistory)}
          >
            <Clock className="w-4 h-4" />
          </Button>
          <Button onClick={startNewChat} variant="outline" className="gap-2">
            <Plus className="w-4 h-4" /> <span className="hidden sm:inline">New Chat</span>
          </Button>
        </div>
      </div>

      <div className="flex-1 flex gap-6 overflow-hidden relative">
        {/* Sidebar for History */}
        <Card className={cn(
          "w-64 flex flex-col p-0 overflow-hidden bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 transition-all duration-300 z-30",
          "md:relative md:translate-x-0 absolute inset-y-0 left-0 shadow-xl md:shadow-none",
          showHistory ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}>
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50 flex justify-between items-center">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Chat History</h3>
            <div className="flex items-center gap-1">
              {sessions.length > 0 && (
                <button 
                  onClick={clearAllHistory}
                  className="p-1 hover:bg-red-50 text-slate-400 hover:text-red-500 rounded transition-colors"
                  title="Clear All"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
              <button onClick={() => setShowHistory(false)} className="md:hidden p-1 hover:bg-slate-200 rounded">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {sessions.length === 0 && (
              <p className="text-xs text-slate-400 text-center py-8">No past sessions</p>
            )}
            {sessions.map((session) => (
              <div
                key={session.id}
                onClick={() => loadSession(session)}
                className={cn(
                  "group relative w-full text-left p-3 rounded-lg text-sm transition-colors cursor-pointer",
                  currentSessionId === session.id 
                    ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 font-medium" 
                    : "hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400"
                )}
              >
                <div className="truncate pr-6">{session.title}</div>
                <div className="text-[10px] opacity-60 mt-1">
                  {session.createdAt?.toDate().toLocaleDateString()}
                </div>
                <button 
                  onClick={(e) => deleteSession(e, session.id)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </Card>

        {/* Chat Area */}
        <Card className="flex-1 flex flex-col p-0 overflow-hidden bg-slate-50/50 dark:bg-slate-950/50">
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-4">
                <div className="w-16 h-16 bg-indigo-100 dark:bg-indigo-900/30 rounded-full flex items-center justify-center">
                  <Brain className="text-indigo-600 dark:text-indigo-400 w-8 h-8" />
                </div>
                <div>
                  <h3 className="font-bold text-lg">How can I help you today?</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xs">Try asking: "Explain photosynthesis" or "Help me with a math problem"</p>
                </div>
              </div>
            )}
            {messages.map((msg, i) => (
              <div 
                key={i} 
                className={cn("flex group", msg.role === 'user' ? "justify-end" : "justify-start")}
                onClick={() => setSelectedMessageIndex(selectedMessageIndex === i ? null : i)}
              >
                <div className={cn(
                  "relative max-w-[85%] p-4 rounded-2xl shadow-sm transition-all duration-200",
                  msg.role === 'user' 
                    ? "bg-indigo-600 text-white rounded-tr-none" 
                    : "bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-tl-none border border-slate-100 dark:border-slate-700",
                  selectedMessageIndex === i && "ring-2 ring-indigo-400 ring-offset-2"
                )}>
                  <div className="prose prose-sm max-w-none dark:prose-invert">
                    <Markdown>{msg.content}</Markdown>
                  </div>
                  
                  {/* Message Actions */}
                  <div className={cn(
                    "absolute top-2 flex gap-1 transition-all duration-200",
                    "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
                    selectedMessageIndex === i && "opacity-100",
                    msg.role === 'user' ? "right-full mr-2" : "left-full ml-2"
                  )}>
                    <button 
                      onClick={(e) => { e.stopPropagation(); copyMessage(msg.content); }}
                      className="p-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-400 hover:text-indigo-600 shadow-sm active:scale-90"
                      title="Copy"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    {currentSessionId && (
                      <button 
                        onClick={(e) => { e.stopPropagation(); deleteMessage(i); }}
                        className="p-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-400 hover:text-red-500 shadow-sm active:scale-90"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl rounded-tl-none border border-slate-100 dark:border-slate-700 shadow-sm flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-indigo-600 dark:text-indigo-400" />
                  <span className="text-sm text-slate-500 dark:text-slate-400">AI is thinking...</span>
                </div>
              </div>
            )}
            <div ref={scrollRef} />
          </div>

          <div className="p-4 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 space-y-4">
            {attachedFiles.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {attachedFiles.map((file, idx) => (
                  <div key={idx} className="flex items-center gap-2 px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded-md text-xs text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                    <span className="truncate max-w-[100px]">{file.name}</span>
                    <button onClick={() => removeFile(idx)} className="text-slate-400 hover:text-red-500">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileSelect} 
                className="hidden" 
                multiple
                accept="image/*,.pdf,.doc,.docx,.txt"
              />
              <Button 
                variant="outline" 
                size="icon" 
                className="shrink-0"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="w-4 h-4" />
              </Button>
              <Input 
                placeholder="Type your question here..." 
                value={input} 
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              />
              <Button onClick={handleSend} disabled={loading}>
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </motion.div>
  );
}

function NewsView({ user, customApiKey }: { user: FirebaseUser | null, customApiKey: string }) {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [topic, setTopic] = useState('');
  const [generating, setGenerating] = useState(false);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'news'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as NewsItem));
      setNews(items);
    });
    return () => unsubscribe();
  }, []);

  const handleGenerateNews = async () => {
    if (!topic.trim() || !user) return;
    setGenerating(true);
    try {
      const content = await generateNews(topic, customApiKey);
      const title = content.split('\n')[0].replace('#', '').trim();
      
      await addDoc(collection(db, 'news'), {
        title: title || `News about ${topic}`,
        content: content,
        authorName: user.displayName || 'Anonymous',
        authorUid: user.uid,
        createdAt: serverTimestamp(),
      });
      
      setTopic('');
      setShowForm(false);
      toast.success('News generated and posted!');
    } catch (err) {
      toast.error('Failed to generate news');
    } finally {
      setGenerating(false);
    }
  };

  const handleAutoNews = async () => {
    if (!user) return;
    setGenerating(true);
    try {
      const content = await generateAutoNews(customApiKey);
      const title = content.split('\n')[0].replace('#', '').trim();
      
      await addDoc(collection(db, 'news'), {
        title: title || "Global AI Update",
        content: content,
        authorName: "IS Connectify AI",
        authorUid: user.uid, // Use current user's UID to pass security rules
        createdAt: serverTimestamp(),
        isAiGenerated: true
      });
      
      toast.success('AI has posted a new update!');
    } catch (err) {
      toast.error('AI failed to generate news');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-6"
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Newspaper className="text-emerald-600" />
            এআই নিউজ ফিড (AI News Feed)
          </h2>
          <p className="text-slate-500 text-sm">এআই দ্বারা সংগৃহীত এবং তৈরি করা সর্বশেষ আপডেট।</p>
        </div>
        <div className="flex gap-2">
          {user && (
            <>
              <Button onClick={handleAutoNews} disabled={generating} variant="secondary" className="bg-slate-900">
                <Sparkles className="w-4 h-4 text-amber-400" /> এআই অটো-পোস্ট (AI Auto-Post)
              </Button>
              <Button onClick={() => setShowForm(!showForm)} variant={showForm ? 'outline' : 'primary'}>
                {showForm ? 'বাতিল' : <><Plus className="w-4 h-4" /> ম্যানুয়াল টপিক</>}
              </Button>
            </>
          )}
        </div>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <Card className="p-6 bg-emerald-50 border-emerald-100">
              <div className="space-y-4">
                <h3 className="font-bold text-emerald-900">নতুন নিউজ তৈরি করুন</h3>
                <div className="flex gap-2">
                  <Input 
                    placeholder="একটি বিষয় লিখুন (যেমন: বাংলাদেশের শিক্ষা ব্যবস্থা, নতুন প্রযুক্তি...)" 
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                  />
                  <Button onClick={handleGenerateNews} disabled={generating}>
                    {generating ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'তৈরি করুন'}
                  </Button>
                </div>
                <p className="text-xs text-emerald-700">এআই গুগলে সার্চ করে সর্বশেষ তথ্য খুঁজে আপনার জন্য একটি নিউজ লিখবে।</p>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-slate-200 border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        {news.map((item) => (
          <div key={item.id} className="bg-white p-6 flex flex-col group hover:bg-slate-50 transition-colors">
            <div className="space-y-4 flex-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={cn(
                    "w-2 h-2 rounded-full animate-pulse",
                    item.authorUid === 'system-ai' ? "bg-amber-500" : "bg-emerald-500"
                  )} />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    {item.authorUid === 'system-ai' ? 'এআই ইন্টেলিজেন্স' : 'ব্যবহারকারীর অবদান'}
                  </span>
                </div>
                <span className="font-mono text-[10px] text-slate-400">
                  {item.createdAt?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              
              <h3 className="text-xl font-bold leading-tight group-hover:text-indigo-600 transition-colors">
                {item.title}
              </h3>
              
              <div className="prose prose-sm line-clamp-3 text-slate-500 font-medium leading-relaxed">
                <Markdown>{item.content}</Markdown>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-slate-100 rounded flex items-center justify-center text-[10px] font-bold text-slate-600 uppercase">
                  {item.authorName.substring(0, 2)}
                </div>
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{item.authorName}</span>
              </div>
              <button className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest hover:underline">
                Read Article
              </button>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

function MediaView({ customApiKey }: { customApiKey: string }) {
  const [activeMediaTab, setActiveMediaTab] = useState<'image' | 'video'>('image');
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [resultType, setResultType] = useState<'image' | 'video'>('image');
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [imageSize, setImageSize] = useState('');
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [style, setStyle] = useState('');
  const [chaos, setChaos] = useState(0);
  const [stylize, setStylize] = useState(250);
  const [progress, setProgress] = useState(0);

  const presets = [
    { id: 'artistic', label: 'Artistic', icon: <Sparkles className="w-3 h-3" />, style: 'artistic style, vibrant colors, brush strokes, masterpiece' },
    { id: 'photorealistic', label: 'Photorealistic', icon: <Camera className="w-3 h-3" />, style: 'photorealistic, highly detailed, 8k, realistic lighting, sharp focus' },
    { id: 'abstract', label: 'Abstract', icon: <Brain className="w-3 h-3" />, style: 'abstract art, conceptual, geometric shapes, expressive, unique' },
    { id: 'cinematic', label: 'Cinematic', icon: <Video className="w-3 h-3" />, style: 'cinematic lighting, dramatic atmosphere, high contrast, movie scene' }
  ];

  const handleGenerateImage = async () => {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setResult(null);
    setResultType('image');
    setProgress(0);

    const progressInterval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 95) return prev;
        return prev + 5;
      });
    }, 500);

    try {
      const styleSuffix = selectedPreset ? `, ${presets.find(p => p.id === selectedPreset)?.style}` : '';
      const fullPrompt = `${prompt}${styleSuffix}`;
      const url = await generateImage(fullPrompt, { 
        aspectRatio, 
        imageSize, 
        customKey: customApiKey,
        style: style || undefined,
        chaos: chaos || undefined,
        stylize: stylize || undefined
      });
      setResult(url);
      setProgress(100);
    } catch (err) {
      console.error('Image generation error:', err);
      toast.error('Generation failed. Check your API key if required.');
    } finally {
      clearInterval(progressInterval);
      setLoading(false);
    }
  };

  const handleGenerateVideo = async () => {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setResult(null);
    setResultType('video');
    setProgress(0);

    try {
      const operation = await generateVideo(prompt, { 
        aspectRatio: (aspectRatio === '16:9' || aspectRatio === '9:16') ? aspectRatio : '16:9' as any, 
        customKey: customApiKey 
      });

      setProgress(10);

      const finalOp = await pollVideoOperation(operation, customApiKey, (op) => {
        setProgress(prev => Math.min(prev + 10, 95));
      });

      const downloadLink = finalOp.response?.generatedVideos?.[0]?.video?.uri;
      if (downloadLink) {
        const videoUrl = await getVideoResult(downloadLink, customApiKey);
        setResult(videoUrl);
      } else {
        throw new Error("No video link found in response");
      }
      setProgress(100);
    } catch (err) {
      console.error('Video generation error:', err);
      toast.error('Video generation failed. This model requires a paid Gemini API key.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-8 max-w-7xl mx-auto"
    >
      <div className="text-center space-y-2">
        <h2 className="text-4xl font-black tracking-tighter uppercase font-display">AI Studio</h2>
        <p className="text-slate-500 max-w-2xl mx-auto">Transform your ideas into high-fidelity visuals and cinematic videos with our state-of-the-art AI engine.</p>
      </div>

      <div className="flex justify-center mb-8">
        <div className="bg-slate-100 p-1 rounded-xl flex gap-1">
          <button
            onClick={() => { setActiveMediaTab('image'); setResult(null); }}
            className={cn(
              "flex items-center gap-2 px-6 py-2 rounded-lg text-sm font-bold transition-all",
              activeMediaTab === 'image' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
            )}
          >
            <ImageIcon className="w-4 h-4" />
            Image
          </button>
          <button
            onClick={() => { setActiveMediaTab('video'); setResult(null); }}
            className={cn(
              "flex items-center gap-2 px-6 py-2 rounded-lg text-sm font-bold transition-all",
              activeMediaTab === 'video' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
            )}
          >
            <Video className="w-4 h-4" />
            Video
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
        {/* Left Column: Controls */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="p-6 space-y-6">
            {activeMediaTab === 'image' && (
              <div className="space-y-3">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Style Presets</label>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setSelectedPreset(null)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-bold transition-all border",
                      selectedPreset === null 
                        ? "bg-slate-900 text-white border-slate-900" 
                        : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                    )}
                  >
                    None
                  </button>
                  {presets.map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => setSelectedPreset(preset.id)}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all border",
                        selectedPreset === preset.id 
                          ? "bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-200" 
                          : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                      )}
                    >
                      {preset.icon}
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-4">
              <label className="text-sm font-bold text-slate-700">
                {activeMediaTab === 'image' ? 'Describe what you want to create' : 'Describe the video scene'}
              </label>
              <TextArea 
                placeholder={activeMediaTab === 'image' ? "A futuristic city at sunset, cinematic lighting, 8k..." : "A cinematic drone shot of a lush tropical island, crystal clear water, 4k..."}
                rows={3}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </div>

            <div className="space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Aspect Ratio</label>
                  <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full uppercase tracking-widest">
                    {aspectRatio}
                  </span>
                </div>
                
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { val: '1:1', label: 'Square', class: 'aspect-square', hideInVideo: true },
                    { val: '16:9', label: 'Landscape', class: 'aspect-video', hideInVideo: false },
                    { val: '9:16', label: 'Portrait', class: 'aspect-[9/16]', hideInVideo: false },
                    { val: '4:3', label: 'Classic', class: 'aspect-[4/3]', hideInVideo: true }
                  ].filter(r => activeMediaTab === 'image' || !r.hideInVideo).map((ratio) => (
                    <button
                      key={ratio.val}
                      onClick={() => setAspectRatio(ratio.val)}
                      className={cn(
                        "flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all",
                        aspectRatio === ratio.val 
                          ? "border-indigo-600 bg-indigo-50/50" 
                          : "border-slate-100 hover:border-slate-200 bg-white"
                      )}
                    >
                      <div className={cn(
                        "w-10 bg-slate-200 rounded-sm border border-slate-300 shadow-inner transition-all",
                        ratio.class,
                        aspectRatio === ratio.val ? "bg-indigo-200 border-indigo-300" : ""
                      )} />
                      <span className={cn(
                        "text-[10px] font-bold uppercase tracking-tighter",
                        aspectRatio === ratio.val ? "text-indigo-700" : "text-slate-500"
                      )}>
                        {ratio.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {activeMediaTab === 'image' && (
                <>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Quality (Requires Paid Key)</label>
                    <select 
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none"
                      value={imageSize}
                      onChange={(e) => setImageSize(e.target.value)}
                    >
                      <option value="">Standard (Flash)</option>
                      <option value="1K">1K (Pro)</option>
                      <option value="2K">2K (Pro)</option>
                      <option value="4K">4K (Pro)</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-4 border-t border-slate-100">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Style</label>
                      <select 
                        className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none"
                        value={style}
                        onChange={(e) => setStyle(e.target.value)}
                      >
                        <option value="">Default</option>
                        <option value="vivid">Vivid</option>
                        <option value="natural">Natural</option>
                        <option value="sketch">Sketch</option>
                        <option value="3d">3D Render</option>
                      </select>
                    </div>

                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Chaos</label>
                        <span className="text-xs font-mono text-indigo-600">{chaos}</span>
                      </div>
                      <input 
                        type="range" 
                        min="0" 
                        max="100" 
                        value={chaos} 
                        onChange={(e) => setChaos(parseInt(e.target.value))}
                        className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Stylize</label>
                        <span className="text-xs font-mono text-indigo-600">{stylize}</span>
                      </div>
                      <input 
                        type="range" 
                        min="0" 
                        max="1000" 
                        value={stylize} 
                        onChange={(e) => setStylize(parseInt(e.target.value))}
                        className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                      />
                    </div>
                  </div>
                </>
              )}

              {activeMediaTab === 'video' && (
                <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl space-y-2">
                  <div className="flex items-center gap-2 text-amber-700">
                    <Sparkles className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase tracking-wider">Pro Feature</span>
                  </div>
                  <p className="text-[10px] text-amber-600 leading-relaxed">
                    Video generation using Veo requires a paid Google Cloud API key. 
                    Generation can take 1-3 minutes.
                  </p>
                </div>
              )}

              <Button 
                className="w-full h-12 text-lg font-bold"
                onClick={activeMediaTab === 'image' ? handleGenerateImage : handleGenerateVideo}
                disabled={loading || !prompt.trim()}
              >
                {loading ? (
                  <div className="flex items-center gap-2">
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    {activeMediaTab === 'image' ? 'Generating Image...' : 'Generating Video...'}
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    {activeMediaTab === 'image' ? <ImageIcon className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                    {activeMediaTab === 'image' ? 'Generate Image' : 'Generate Video'}
                  </div>
                )}
              </Button>
            </div>
          </Card>
        </div>

        {/* Right Column: Result */}
        <div className="lg:col-span-3 space-y-6">
          <Card className="overflow-hidden bg-slate-50 border-2 border-dashed border-slate-200 min-h-[500px] flex flex-col items-center justify-center relative group">
            {loading && (
              <div className="absolute inset-0 z-20 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center p-8 text-center space-y-6">
                <div className="relative">
                  <div className="w-24 h-24 border-4 border-slate-100 border-t-indigo-600 rounded-full animate-spin" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-sm font-bold text-indigo-600">{progress}%</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-bold text-slate-900">
                    {activeMediaTab === 'image' ? 'Crafting your masterpiece...' : 'Directing your cinematic scene...'}
                  </h3>
                  <p className="text-sm text-slate-500 max-w-xs mx-auto">
                    {activeMediaTab === 'image' 
                      ? 'Our AI is processing your prompt to create a unique high-fidelity image.' 
                      : 'Veo is generating high-quality video frames. This may take a few minutes.'}
                  </p>
                </div>
                <div className="w-full max-w-xs h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <motion.div 
                    className="h-full bg-indigo-600"
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}

            {result ? (
              <div className="w-full h-full flex flex-col">
                <div className="flex-1 flex items-center justify-center p-4">
                  {resultType === 'image' ? (
                    <img 
                      src={result} 
                      alt="Generated" 
                      className={cn(
                        "max-w-full max-h-[600px] rounded-lg shadow-2xl object-contain bg-white",
                        aspectRatio === '1:1' ? 'aspect-square' : 
                        aspectRatio === '16:9' ? 'aspect-video' : 
                        aspectRatio === '9:16' ? 'aspect-[9/16]' : 'aspect-[4/3]'
                      )}
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <video 
                      src={result} 
                      controls 
                      autoPlay 
                      loop 
                      className={cn(
                        "max-w-full max-h-[600px] rounded-lg shadow-2xl object-contain bg-black",
                        aspectRatio === '16:9' ? 'aspect-video' : 'aspect-[9/16]'
                      )}
                    />
                  )}
                </div>
                
                <div className="p-4 bg-white border-t border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => {
                        const link = document.createElement('a');
                        link.href = result;
                        link.download = resultType === 'image' ? 'generated-image.png' : 'generated-video.mp4';
                        link.click();
                      }}
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Download
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(result);
                        toast.success('Link copied to clipboard!');
                      }}
                    >
                      <Copy className="w-4 h-4 mr-2" />
                      Copy Link
                    </Button>
                  </div>
                  
                  <Button 
                    size="sm"
                    className="bg-indigo-600 hover:bg-indigo-700"
                    onClick={async () => {
                      if (navigator.share) {
                        try {
                          await navigator.share({
                            title: 'Generated with IS Connectify',
                            text: prompt,
                            url: result
                          });
                        } catch (err) {
                          console.error('Share failed:', err);
                        }
                      } else {
                        navigator.clipboard.writeText(result);
                        toast.success('Link copied to clipboard!');
                      }
                    }}
                  >
                    <Share2 className="w-4 h-4 mr-2" />
                    Share
                  </Button>
                </div>
              </div>
            ) : (
              <div className="text-center space-y-4 p-8">
                <div className="w-20 h-20 bg-slate-100 rounded-3xl flex items-center justify-center mx-auto mb-4 border border-slate-200">
                  {activeMediaTab === 'image' ? <ImageIcon className="w-10 h-10 text-slate-300" /> : <Video className="w-10 h-10 text-slate-300" />}
                </div>
                <div className="space-y-2">
                  <h3 className="text-lg font-bold text-slate-400">Ready to Create</h3>
                  <p className="text-sm text-slate-400 max-w-[250px] mx-auto">
                    {activeMediaTab === 'image' 
                      ? 'Enter a prompt on the left to generate your first AI image.' 
                      : 'Enter a prompt on the left to generate your first AI video with Veo.'}
                  </p>
                </div>
                
                {/* Visual Aspect Ratio Placeholder */}
                <div className="mt-8 flex justify-center">
                  <div className={cn(
                    "w-32 bg-slate-100 border-2 border-dashed border-slate-200 rounded-lg transition-all duration-500 opacity-50",
                    aspectRatio === '1:1' ? 'aspect-square' : 
                    aspectRatio === '16:9' ? 'aspect-video' : 
                    aspectRatio === '9:16' ? 'aspect-[9/16]' : 'aspect-[4/3]'
                  )} />
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </motion.div>
  );
}

function UserProfile({ user }: { user: FirebaseUser | null }) {
  const [profile, setProfile] = useState<IUserProfile | null>(null);
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [photoURL, setPhotoURL] = useState('');
  const [studentClass, setStudentClass] = useState('');
  const [department, setDepartment] = useState<'Science' | 'Commerce' | 'Arts' | 'None'>('None');
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;
    const unsubscribe = onSnapshot(doc(db, 'users', user.uid), (snap) => {
      if (snap.exists()) {
        const data = snap.data() as IUserProfile;
        setProfile(data);
        setDisplayName(data.displayName);
        setBio(data.bio || '');
        setPhotoURL(data.photoURL || '');
        setStudentClass(data.studentClass || '');
        setDepartment(data.department || 'None');
      }
    });
    return () => unsubscribe();
  }, [user]);

  const handleSave = async () => {
    if (!user || saving) return;
    setSaving(true);
    try {
      await updateProfile(user.uid, { displayName, bio, photoURL, studentClass, department });
      setEditing(false);
      toast.success('Profile updated successfully!');
    } catch (err) {
      toast.error('Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = ev.target?.result as string;
      setPhotoURL(base64);
      toast.success('Photo uploaded locally. Click Save to persist.');
    };
    reader.readAsDataURL(file);
  };

  if (!user) {
    return (
      <div className="h-[60vh] flex flex-col items-center justify-center text-center space-y-4">
        <div className="w-20 h-20 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center">
          <User className="text-slate-400 dark:text-slate-500 w-10 h-10" />
        </div>
        <h2 className="text-xl font-bold">Please sign in to view your profile</h2>
        <Button onClick={signInWithGoogle}>Sign In with Google</Button>
      </div>
    );
  }

  if (!profile) return <div className="flex justify-center p-12"><RefreshCw className="animate-spin" /></div>;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-3xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">User Profile</h2>
        <Button variant={editing ? 'outline' : 'primary'} onClick={() => setEditing(!editing)}>
          {editing ? 'Cancel' : 'Edit Profile'}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <Card className="p-6 flex flex-col items-center text-center space-y-4 h-fit">
          <div className="relative group">
            <img 
              src={photoURL || 'https://picsum.photos/seed/user/200/200'} 
              alt="" 
              className="w-32 h-32 rounded-full border-4 border-white shadow-xl object-cover" 
              referrerPolicy="no-referrer"
            />
            {editing && (
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="absolute inset-0 bg-black/40 rounded-full flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer text-white"
              >
                <Camera className="w-6 h-6 mb-1" />
                <span className="text-[10px] font-bold uppercase">Change</span>
              </button>
            )}
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileChange} 
              className="hidden" 
              accept="image/*"
            />
          </div>
          <div>
            <h3 className="text-xl font-bold">{profile.displayName}</h3>
            <p className="text-sm text-slate-500">{profile.email}</p>
          </div>
          <div className={cn(
            "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest",
            profile.role === 'admin' ? "bg-amber-100 text-amber-700" : "bg-indigo-50 text-indigo-600"
          )}>
            {profile.role === 'admin' && <Sparkles className="w-3 h-3" />}
            {profile.role}
          </div>

          <div className="w-full pt-4 space-y-3 text-left border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400 font-bold uppercase tracking-widest">ক্লাস (Class)</span>
              <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{profile.studentClass || 'Not set'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400 font-bold uppercase tracking-widest">বিভাগ (Dept.)</span>
              <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{profile.department || 'None'}</span>
            </div>
          </div>
        </Card>

        <Card className="md:col-span-2 p-8 space-y-6">
          {editing ? (
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Display Name</label>
                <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Profile Picture URL</label>
                <Input value={photoURL} onChange={(e) => setPhotoURL(e.target.value)} placeholder="https://..." />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Bio</label>
                <TextArea value={bio} onChange={(e) => setBio(e.target.value)} rows={4} placeholder="Tell us about yourself..." />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">আপনার ক্লাস (Class)</label>
                  <Input value={studentClass} onChange={(e) => setStudentClass(e.target.value)} placeholder="e.g. Class 10" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">আপনার বিভাগ (Dept.)</label>
                  <select 
                    value={department} 
                    onChange={(e) => setDepartment(e.target.value as any)}
                    className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white text-sm"
                  >
                    <option value="None">None</option>
                    <option value="Science">Science</option>
                    <option value="Commerce">Commerce</option>
                    <option value="Arts">Arts</option>
                  </select>
                </div>
              </div>

              <Button className="w-full" onClick={handleSave} disabled={saving}>
                {saving ? <RefreshCw className="animate-spin" /> : 'Save Changes'}
              </Button>
            </div>
          ) : (
            <div className="space-y-8">
              <div className="space-y-1">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">About Me</h4>
                <p className="text-slate-700 leading-relaxed">
                  {profile.bio || "No bio added yet. Tell the community about yourself!"}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Account Status</p>
                  <p className="text-sm font-bold text-emerald-600">Verified</p>
                </div>
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Member Since</p>
                  <p className="text-sm font-bold text-slate-700">March 2026</p>
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>
    </motion.div>
  );
}

function SettingsView({ apiKey, setApiKey, theme, setTheme }: { apiKey: string, setApiKey: (k: string) => void, theme: 'light' | 'dark', setTheme: (t: 'light' | 'dark') => void }) {
  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="max-w-2xl mx-auto space-y-8"
    >
      <div className="space-y-2">
        <h2 className="text-2xl font-bold">Settings</h2>
        <p className={theme === 'dark' ? "text-slate-400" : "text-slate-500"}>Configure your application preferences and API keys.</p>
      </div>

      <Card className={cn("p-6 space-y-6", theme === 'dark' && "bg-slate-900 border-slate-800")}>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold flex items-center gap-2">
              {theme === 'dark' ? <Volume2 className="text-indigo-400 w-5 h-5" /> : <Sparkles className="text-amber-500 w-5 h-5" />}
              Appearance
            </h3>
          </div>
          <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-800">
            <div className="space-y-1">
              <p className="text-sm font-bold">Dark Mode</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Switch between light and dark themes.</p>
            </div>
            <button 
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
              className={cn(
                "w-14 h-8 rounded-full p-1 transition-colors duration-300 flex items-center",
                theme === 'dark' ? "bg-indigo-600" : "bg-slate-200"
              )}
            >
              <motion.div 
                animate={{ x: theme === 'dark' ? 24 : 0 }}
                className="w-6 h-6 bg-white rounded-full shadow-sm flex items-center justify-center"
              >
                {theme === 'dark' ? <Mic className="w-3 h-3 text-indigo-600" /> : <Sparkles className="w-3 h-3 text-amber-500" />}
              </motion.div>
            </button>
          </div>
        </div>

        <div className="space-y-4 pt-6 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <h3 className="font-bold flex items-center gap-2">
              <Sparkles className="text-amber-500 w-5 h-5" />
              Custom API Key
            </h3>
            <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-1 rounded">Optional</span>
          </div>
          <p className={cn("text-sm", theme === 'dark' ? "text-slate-400" : "text-slate-500")}>
            Some advanced models like Veo (Video) and Imagen (High-Quality Images) require a paid Google Cloud API key. 
            If you have one, you can enter it here.
          </p>
          <div className="relative">
            <Input 
              type="password" 
              placeholder="Enter your Google Cloud API Key..." 
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="pr-12"
            />
            <Settings className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 w-5 h-5" />
          </div>
          <p className={cn("text-[10px]", theme === 'dark' ? "text-slate-500" : "text-slate-400")}>
            Your key is stored locally in your browser session and is never sent to our servers.
          </p>
        </div>
      </Card>

      <Card className="p-6 bg-slate-900 text-white border-none">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center">
            <User className="text-white w-6 h-6" />
          </div>
          <div>
            <h3 className="font-bold">Developer Credit</h3>
            <p className="text-slate-400 text-sm">Create by Imran Samir</p>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

function StudyGroupsView({ user }: { user: FirebaseUser | null }) {
  const [groups, setGroups] = useState<any[]>([]);
  const [joinedGroups, setJoinedGroups] = useState<any[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<any | null>(null);
  const [resources, setResources] = useState<any[]>([]);
  const [groupName, setGroupName] = useState('');
  const [groupDesc, setGroupDesc] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [resourceTitle, setResourceTitle] = useState('');
  const [resourceContent, setResourceContent] = useState('');
  const [resourceType, setResourceType] = useState<'note' | 'task'>('note');
  const [activeGroupTab, setActiveGroupTab] = useState<'resources' | 'members'>('resources');
  const [groupMembers, setGroupMembers] = useState<any[]>([]);

  useEffect(() => {
    if (!user) return;
    
    // Listen to all groups (for discovery/joining)
    const qGroups = query(collection(db, 'groups'), orderBy('createdAt', 'desc'));
    const unsubGroups = onSnapshot(qGroups, (snap) => {
      setGroups(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    // Listen to groups user has joined
    const qMembers = query(collection(db, 'group_members'), where('userId', '==', user.uid));
    const unsubMembers = onSnapshot(qMembers, (snap) => {
      const gIds = snap.docs.map(doc => doc.data().groupId);
      setJoinedGroups(gIds);
    });

    return () => {
      unsubGroups();
      unsubMembers();
    };
  }, [user]);

  useEffect(() => {
    if (!selectedGroup) return;
    
    // Resources listener
    const qRes = query(collection(db, 'group_resources'), where('groupId', '==', selectedGroup.id), orderBy('createdAt', 'desc'));
    const unsubRes = onSnapshot(qRes, (snap) => {
      setResources(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    // Members listener
    const qMem = query(collection(db, 'group_members'), where('groupId', '==', selectedGroup.id));
    const unsubMem = onSnapshot(qMem, async (snap) => {
      const memberData = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // Fetch display names for members
      const membersWithNames = await Promise.all(memberData.map(async (m: any) => {
        try {
          const userDoc = await getDoc(doc(db, 'users', m.userId));
          return { ...m, displayName: userDoc.exists() ? userDoc.data().displayName : 'Unknown User' };
        } catch {
          return { ...m, displayName: 'Unknown User' };
        }
      }));
      setGroupMembers(membersWithNames);
    });

    return () => {
      unsubRes();
      unsubMem();
    };
  }, [selectedGroup]);

  const createGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !groupName.trim()) return;
    setLoading(true);
    try {
      const code = Math.random().toString(36).substring(2, 8).toUpperCase();
      const groupRef = await addDoc(collection(db, 'groups'), {
        name: groupName,
        description: groupDesc,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        inviteCode: code
      });

      // Automatically join the group
      await setDoc(doc(db, 'group_members', `${user.uid}_${groupRef.id}`), {
        groupId: groupRef.id,
        userId: user.uid,
        role: 'owner',
        joinedAt: serverTimestamp()
      });

      setGroupName('');
      setGroupDesc('');
      toast.success('Group created!');
    } catch (err) {
      toast.error('Failed to create group');
    } finally {
      setLoading(false);
    }
  };

  const joinGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !inviteCode.trim()) return;
    setLoading(true);
    try {
      const q = query(collection(db, 'groups'), where('inviteCode', '==', inviteCode.trim().toUpperCase()));
      const snap = await getDocs(q);
      if (snap.empty) {
        toast.error('Invalid invite code');
        return;
      }
      const group = snap.docs[0];
      
      await setDoc(doc(db, 'group_members', `${user.uid}_${group.id}`), {
        groupId: group.id,
        userId: user.uid,
        role: 'member',
        joinedAt: serverTimestamp()
      });

      setInviteCode('');
      toast.success('Joined group!');
    } catch (err) {
      toast.error('Failed to join group');
    } finally {
      setLoading(false);
    }
  };

  const addResource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedGroup || !resourceTitle.trim()) return;
    setLoading(true);
    try {
      await addDoc(collection(db, 'group_resources'), {
        groupId: selectedGroup.id,
        title: resourceTitle,
        content: resourceContent,
        type: resourceType,
        completed: false,
        createdBy: user.uid,
        createdAt: serverTimestamp()
      });
      setResourceTitle('');
      setResourceContent('');
      toast.success('Resource shared!');
    } catch (err) {
      toast.error('Failed to share resource');
    } finally {
      setLoading(false);
    }
  };

  const toggleGroupTask = async (id: string, completed: boolean) => {
    try {
      const { updateDoc, doc } = await import('firebase/firestore');
      await updateDoc(doc(db, 'group_resources', id), { completed: !completed });
    } catch (err) {
      toast.error('Failed to update task');
    }
  };

  const deleteResource = async (id: string) => {
    try {
      const { deleteDoc, doc } = await import('firebase/firestore');
      await deleteDoc(doc(db, 'group_resources', id));
      toast.success('Resource deleted');
    } catch (err) {
      toast.error('Failed to delete resource');
    }
  };

  const leaveGroup = async () => {
    if (!user || !selectedGroup) return;
    try {
      const { deleteDoc, doc } = await import('firebase/firestore');
      await deleteDoc(doc(db, 'group_members', `${user.uid}_${selectedGroup.id}`));
      setSelectedGroup(null);
      toast.success('Left group');
    } catch (err) {
      toast.error('Failed to leave group');
    }
  };

  const deleteGroup = async () => {
    if (!user || !selectedGroup || selectedGroup.createdBy !== user.uid) return;
    setLoading(true);
    try {
      const { writeBatch, query, collection, where, getDocs, doc } = await import('firebase/firestore');
      const batch = writeBatch(db);
      
      // Delete all members
      const membersSnap = await getDocs(query(collection(db, 'group_members'), where('groupId', '==', selectedGroup.id)));
      membersSnap.forEach(m => batch.delete(m.ref));
      
      // Delete all resources
      const resourcesSnap = await getDocs(query(collection(db, 'group_resources'), where('groupId', '==', selectedGroup.id)));
      resourcesSnap.forEach(r => batch.delete(r.ref));
      
      // Delete the group
      batch.delete(doc(db, 'groups', selectedGroup.id));
      
      await batch.commit();
      setSelectedGroup(null);
      toast.success('Group deleted successfully');
    } catch (err) {
      toast.error('Failed to delete group');
    } finally {
      setLoading(false);
    }
  };

  const removeMember = async (memberId: string) => {
    try {
      const { deleteDoc, doc } = await import('firebase/firestore');
      await deleteDoc(doc(db, 'group_members', memberId));
      toast.success('Member removed');
    } catch (err) {
      toast.error('Failed to remove member');
    }
  };

  if (!user) {
    return (
      <div className="h-[60vh] flex flex-col items-center justify-center text-center space-y-4">
        <Users className="w-16 h-16 text-slate-200" />
        <h2 className="text-xl font-bold">Sign in to join study groups</h2>
        <Button onClick={signInWithGoogle}>Sign In with Google</Button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Study Groups</h2>
          <p className="text-slate-500 text-sm">Collaborate with fellow students</p>
        </div>
        {selectedGroup && (
          <Button variant="ghost" onClick={() => setSelectedGroup(null)}>
            Back to Groups
          </Button>
        )}
      </div>

      {!selectedGroup ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <Users2 className="text-indigo-600" />
              Your Groups
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {groups.filter(g => joinedGroups.includes(g.id)).map(group => (
                <div key={group.id} onClick={() => setSelectedGroup(group)}>
                  <Card className="p-6 h-full hover:shadow-md transition-all cursor-pointer border-indigo-100 bg-indigo-50/30">
                    <div className="flex justify-between items-start mb-4">
                      <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center text-indigo-600">
                        <Users size={24} />
                      </div>
                      <div className="flex items-center gap-1 text-[10px] font-bold text-indigo-600 bg-indigo-100 px-2 py-1 rounded-full uppercase tracking-widest">
                        <Lock size={10} />
                        {group.inviteCode}
                      </div>
                    </div>
                    <h4 className="font-bold text-lg mb-1">{group.name}</h4>
                    <p className="text-sm text-slate-500 line-clamp-2 mb-4">{group.description}</p>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <Clock size={12} />
                      Joined {group.createdAt?.toDate().toLocaleDateString()}
                    </div>
                  </Card>
                </div>
              ))}
              {joinedGroups.length === 0 && (
                <div className="col-span-full py-12 text-center bg-white rounded-xl border border-dashed border-slate-200">
                  <p className="text-slate-400">You haven't joined any groups yet.</p>
                </div>
              )}
            </div>

            <h3 className="text-lg font-bold flex items-center gap-2 mt-8">
              <Globe className="text-slate-400" />
              Discover Groups
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {groups.filter(g => !joinedGroups.includes(g.id)).map(group => (
                <Card key={group.id} className="p-6 hover:shadow-md transition-all border-slate-200">
                  <h4 className="font-bold text-lg mb-1">{group.name}</h4>
                  <p className="text-sm text-slate-500 line-clamp-2 mb-4">{group.description}</p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <Users size={12} />
                      Public Group
                    </div>
                    <p className="text-xs font-bold text-indigo-600">Invite Code Required</p>
                  </div>
                </Card>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            <Card className="p-6 bg-indigo-600 text-white border-none shadow-xl shadow-indigo-200">
              <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                <Plus className="w-5 h-5" />
                Create Group
              </h3>
              <form onSubmit={createGroup} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-indigo-200 uppercase tracking-widest">Group Name</label>
                  <input 
                    className="w-full bg-indigo-500/50 border border-indigo-400 rounded-lg px-4 py-2 text-white placeholder:text-indigo-200 outline-none focus:ring-2 ring-white/20"
                    placeholder="e.g. Physics Study Squad" 
                    value={groupName} 
                    onChange={e => setGroupName(e.target.value)} 
                    required 
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-indigo-200 uppercase tracking-widest">Description</label>
                  <textarea 
                    className="w-full bg-indigo-500/50 border border-indigo-400 rounded-lg px-4 py-2 text-white placeholder:text-indigo-200 outline-none focus:ring-2 ring-white/20"
                    placeholder="What's this group about?" 
                    value={groupDesc} 
                    onChange={e => setGroupDesc(e.target.value)} 
                    rows={3}
                  />
                </div>
                <Button type="submit" className="w-full bg-white text-indigo-600 hover:bg-indigo-50" disabled={loading}>
                  {loading ? <RefreshCw className="animate-spin" /> : "Create Group"}
                </Button>
              </form>
            </Card>

            <Card className="p-6">
              <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                <Unlock className="w-5 h-5 text-indigo-600" />
                Join with Code
              </h3>
              <form onSubmit={joinGroup} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Invite Code</label>
                  <Input 
                    placeholder="ENTER CODE" 
                    value={inviteCode} 
                    onChange={e => setInviteCode(e.target.value)} 
                    required 
                    className="text-center font-mono tracking-widest uppercase"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? <RefreshCw className="animate-spin" /> : "Join Group"}
                </Button>
              </form>
            </Card>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold">{selectedGroup.name}</h3>
                <div className="flex items-center gap-2 text-xs font-bold text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-full uppercase tracking-widest">
                  <Lock size={12} />
                  Code: {selectedGroup.inviteCode}
                </div>
              </div>
              <p className="text-slate-600 mb-6">{selectedGroup.description}</p>
              
              <div className="flex border-b border-slate-100 mb-6">
                <button 
                  onClick={() => setActiveGroupTab('resources')}
                  className={cn(
                    "px-4 py-2 font-bold text-sm transition-all",
                    activeGroupTab === 'resources' ? "border-b-2 border-indigo-600 text-indigo-600" : "text-slate-400 hover:text-slate-600"
                  )}
                >
                  Resources
                </button>
                <button 
                  onClick={() => setActiveGroupTab('members')}
                  className={cn(
                    "px-4 py-2 font-bold text-sm transition-all",
                    activeGroupTab === 'members' ? "border-b-2 border-indigo-600 text-indigo-600" : "text-slate-400 hover:text-slate-600"
                  )}
                >
                  Members ({groupMembers.length})
                </button>
              </div>

              {activeGroupTab === 'resources' ? (
                <div className="space-y-4">
                  {resources.map(res => (
                    <motion.div 
                      key={res.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex items-start gap-4 group"
                    >
                      <div className={cn(
                        "w-10 h-10 rounded-lg flex items-center justify-center",
                        res.type === 'note' ? "bg-amber-100 text-amber-600" : "bg-emerald-100 text-emerald-600"
                      )}>
                        {res.type === 'note' ? <FileText size={20} /> : <CheckCircle2 size={20} />}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <h4 className="font-bold">{res.title}</h4>
                          <div className="flex items-center gap-2">
                            {res.type === 'task' && (
                              <button 
                                onClick={() => toggleGroupTask(res.id, res.completed)}
                                className={cn(
                                  "text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-widest",
                                  res.completed ? "bg-emerald-100 text-emerald-600" : "bg-slate-200 text-slate-500"
                                )}
                              >
                                {res.completed ? "Completed" : "Mark Done"}
                              </button>
                            )}
                            {(res.createdBy === user.uid || selectedGroup.createdBy === user.uid) && (
                              <button 
                                onClick={() => deleteResource(res.id)}
                                className="p-1 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                        <p className="text-sm text-slate-600 mt-1">{res.content}</p>
                        <div className="flex items-center gap-2 mt-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                          <span>Shared by {res.createdBy === user.uid ? "You" : "Member"}</span>
                          <span>•</span>
                          <span>{res.createdAt?.toDate().toLocaleDateString()}</span>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                  {resources.length === 0 && (
                    <div className="text-center py-12">
                      <FileText className="w-12 h-12 text-slate-200 mx-auto mb-4" />
                      <p className="text-slate-400">No resources shared yet. Be the first!</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  {groupMembers.map(member => (
                    <div key={member.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-200">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 font-bold">
                          {member.displayName.charAt(0)}
                        </div>
                        <div>
                          <p className="font-bold text-sm">{member.displayName} {member.userId === user.uid && "(You)"}</p>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{member.role}</p>
                        </div>
                      </div>
                      {selectedGroup.createdBy === user.uid && member.userId !== user.uid && (
                        <button 
                          onClick={() => removeMember(member.id)}
                          className="text-xs font-bold text-red-500 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-all"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <Card className="p-6">
              <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                <Plus className="w-5 h-5 text-indigo-600" />
                Share Resource
              </h3>
              <form onSubmit={addResource} className="space-y-4">
                {/* ... form content ... */}
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Title</label>
                  <Input 
                    placeholder="e.g. Chapter 5 Summary" 
                    value={resourceTitle} 
                    onChange={e => setResourceTitle(e.target.value)} 
                    required 
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Type</label>
                  <div className="flex gap-2">
                    <button 
                      type="button"
                      onClick={() => setResourceType('note')}
                      className={cn(
                        "flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-widest border transition-all",
                        resourceType === 'note' ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white border-slate-200 text-slate-500"
                      )}
                    >
                      Note
                    </button>
                    <button 
                      type="button"
                      onClick={() => setResourceType('task')}
                      className={cn(
                        "flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-widest border transition-all",
                        resourceType === 'task' ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white border-slate-200 text-slate-500"
                      )}
                    >
                      Task
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Content / Details</label>
                  <TextArea 
                    placeholder="Paste your notes or task details here..." 
                    value={resourceContent} 
                    onChange={e => setResourceContent(e.target.value)} 
                    rows={4}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? <RefreshCw className="animate-spin" /> : "Share with Group"}
                </Button>
              </form>
            </Card>

            <div className="space-y-3">
              {selectedGroup.createdBy === user.uid && (
                <Button 
                  variant="outline" 
                  className="w-full text-red-600 border-red-200 hover:bg-red-50 bg-red-50/30 flex items-center gap-2"
                  onClick={deleteGroup}
                  disabled={loading}
                >
                  <Trash2 className="w-4 h-4" />
                  Delete Group
                </Button>
              )}

              <Button 
                variant="outline" 
                className="w-full text-red-500 border-red-100 hover:bg-red-50 flex items-center gap-2"
                onClick={leaveGroup}
              >
                <LogOut className="w-4 h-4" />
                Leave Group
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
function TasksView({ user }: { user: FirebaseUser | null }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [sortBy, setSortBy] = useState<'dueDate' | 'status' | 'title'>('dueDate');
  const [filterBy, setFilterBy] = useState<'all' | 'completed' | 'pending'>('all');

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'tasks'),
      orderBy('createdAt', 'desc')
    );
    const unsubscribe = onSnapshot(q, (snap) => {
      const list = snap.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as Task))
        .filter(t => t.userId === user.uid);
      setTasks(list);
    });
    return () => unsubscribe();
  }, [user]);

  const filteredAndSortedTasks = useMemo(() => {
    let result = [...tasks];

    // Filter
    if (filterBy === 'completed') {
      result = result.filter(t => t.completed);
    } else if (filterBy === 'pending') {
      result = result.filter(t => !t.completed);
    }

    // Sort
    result.sort((a, b) => {
      if (sortBy === 'title') {
        return a.title.localeCompare(b.title);
      }
      if (sortBy === 'status') {
        return Number(a.completed) - Number(b.completed);
      }
      if (sortBy === 'dueDate') {
        const dateA = a.dueDate ? a.dueDate.toMillis() : Infinity;
        const dateB = b.dueDate ? b.dueDate.toMillis() : Infinity;
        return dateA - dateB;
      }
      return 0;
    });

    return result;
  }, [tasks, sortBy, filterBy]);

  const addTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !title.trim()) return;
    setLoading(true);
    try {
      await addDoc(collection(db, 'tasks'), {
        title,
        description,
        dueDate: dueDate ? Timestamp.fromDate(new Date(dueDate)) : null,
        completed: false,
        userId: user.uid,
        createdAt: serverTimestamp(),
      });
      setTitle('');
      setDescription('');
      setDueDate('');
      toast.success('Task added!');
    } catch (err) {
      toast.error('Failed to add task');
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (id: string, completed: boolean) => {
    try {
      const { updateDoc, doc } = await import('firebase/firestore');
      await updateDoc(doc(db, 'tasks', id), { completed: !completed });
    } catch (err) {
      toast.error('Failed to update task');
    }
  };

  const deleteTask = async (id: string) => {
    try {
      const { deleteDoc, doc } = await import('firebase/firestore');
      await deleteDoc(doc(db, 'tasks', id));
      toast.success('Task deleted');
    } catch (err) {
      toast.error('Failed to delete task');
    }
  };

  if (!user) {
    return (
      <div className="h-[60vh] flex flex-col items-center justify-center text-center space-y-4">
        <CheckCircle2 className="w-16 h-16 text-slate-200" />
        <h2 className="text-xl font-bold">Sign in to manage your study tasks</h2>
        <Button onClick={signInWithGoogle}>Sign In with Google</Button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Study Tasks</h2>
          <p className="text-slate-500 text-sm">Organize your learning schedule</p>
        </div>
      </div>

      <Card className="p-6">
        <form onSubmit={addTask} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Task Title</label>
              <Input 
                placeholder="What do you need to study?" 
                value={title} 
                onChange={e => setTitle(e.target.value)} 
                required 
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Due Date</label>
              <Input 
                type="datetime-local" 
                value={dueDate} 
                onChange={e => setDueDate(e.target.value)} 
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Description</label>
            <TextArea 
              placeholder="Add some details..." 
              value={description} 
              onChange={e => setDescription(e.target.value)} 
              rows={2} 
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <RefreshCw className="animate-spin" /> : <Plus className="w-4 h-4" />}
            Add Task
          </Button>
        </form>
      </Card>

      <div className="flex flex-wrap items-center gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400" />
          <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Filter:</span>
          <select 
            value={filterBy} 
            onChange={(e) => setFilterBy(e.target.value as any)}
            className="text-sm bg-transparent border-none focus:ring-0 cursor-pointer font-medium text-slate-700 outline-none"
          >
            <option value="all">All Tasks</option>
            <option value="completed">Completed</option>
            <option value="pending">Pending</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <ArrowUpDown className="w-4 h-4 text-slate-400" />
          <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Sort by:</span>
          <select 
            value={sortBy} 
            onChange={(e) => setSortBy(e.target.value as any)}
            className="text-sm bg-transparent border-none focus:ring-0 cursor-pointer font-medium text-slate-700 outline-none"
          >
            <option value="dueDate">Due Date</option>
            <option value="status">Status</option>
            <option value="title">Title</option>
          </select>
        </div>
      </div>

      <div className="space-y-4">
        {filteredAndSortedTasks.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-xl border border-dashed border-slate-200">
            <p className="text-slate-400">No tasks found. Try changing your filters or add a new task!</p>
          </div>
        ) : (
          filteredAndSortedTasks.map(task => (
            <motion.div 
              key={task.id} 
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ 
                opacity: task.completed ? 0.6 : 1, 
                scale: task.completed ? 0.98 : 1,
                y: 0 
              }}
              transition={{ duration: 0.2 }}
              className={cn(
                "group flex items-start gap-4 p-4 bg-white border rounded-xl transition-all hover:shadow-md",
                task.completed ? "border-slate-100" : "border-slate-200"
              )}
            >
              <button 
                onClick={() => task.id && handleToggle(task.id, task.completed)}
                className={cn(
                  "mt-1 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all",
                  task.completed 
                    ? "bg-emerald-500 border-emerald-500 text-white" 
                    : "border-slate-300 hover:border-indigo-500 text-transparent"
                )}
              >
                <CheckCircle2 size={14} />
              </button>
              
              <div className="flex-1 min-w-0">
                <h4 className={cn(
                  "font-bold transition-all",
                  task.completed ? "text-slate-400 line-through" : "text-slate-900"
                )}>
                  {task.title}
                </h4>
                {task.description && (
                  <p className="text-sm text-slate-500 mt-1 line-clamp-2">{task.description}</p>
                )}
                {task.dueDate && (
                  <div className="flex items-center gap-1.5 mt-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    <Calendar size={12} />
                    {task.dueDate.toDate().toLocaleString()}
                  </div>
                )}
              </div>

              <button 
                onClick={() => task.id && deleteTask(task.id)}
                className="p-2 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
              >
                <Trash2 size={18} />
              </button>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}
