import React, { useState, useEffect } from 'react';
import {
    UploadCloud,
    FolderUp,
    Image as ImageIcon,
    Sparkles,
    Save,
    Loader2,
    AlertCircle,
    CheckCircle,
    Settings,
    Key,
    User,
    Lock,
    ArrowRight,
    Edit3,
    Trash2,
    Maximize2,
    X,
    Server
} from 'lucide-react';

// --- CONFIGURATION ---
const API_BASE_URL = import.meta.env.VITE_API_URL || "https://api.shutterstacker.yeylab.com";

// --- COMPONENTS ---

const Button = ({ onClick, disabled, variant = "primary", size = "md", icon: Icon, children, className = "" }) => {
    const baseStyles = "flex items-center justify-center font-medium transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 rounded-lg";

    const sizes = {
        sm: "px-3 py-1.5 text-sm",
        md: "px-4 py-2 text-sm",
        lg: "px-6 py-3 text-base"
    };

    const variants = {
        primary: "bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500 shadow-blue-200 hover:shadow-md",
        secondary: "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 focus:ring-slate-200",
        success: "bg-emerald-600 text-white hover:bg-emerald-700 focus:ring-emerald-500 shadow-emerald-200 hover:shadow-md",
        danger: "bg-red-600 text-white hover:bg-red-700 focus:ring-red-500",
        gemini: "bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 text-white hover:opacity-90 border-0 shadow-purple-200 hover:shadow-md"
    };

    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`${baseStyles} ${sizes[size]} ${variants[variant]} ${className}`}
        >
            {Icon && <Icon className={`mr-2 ${size === 'lg' ? 'w-5 h-5' : 'w-4 h-4'}`} />}
            {children}
        </button>
    );
};

const Modal = ({ isOpen, onClose, title, children }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden transform transition-all scale-100">
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                    <h3 className="font-bold text-lg text-slate-800">{title}</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="p-6">
                    {children}
                </div>
            </div>
        </div>
    );
};

// --- MAIN APP ---

export default function App() {
    // State
    const [step, setStep] = useState(1);
    const [showSettings, setShowSettings] = useState(false);

    // Config
    const [groqKey, setGroqKey] = useState(localStorage.getItem('groq_key') || '');
    const [ftpUser, setFtpUser] = useState(localStorage.getItem('ftp_user') || '');
    const [ftpPass, setFtpPass] = useState(localStorage.getItem('ftp_pass') || '');

    // Data
    const [sessionId, setSessionId] = useState(null);
    const [images, setImages] = useState([]); // Array of strings (filenames)
    const [contextMap, setContextMap] = useState({}); // { filename: "context string" }
    const [metadata, setMetadata] = useState([]); // Array of metadata objects

    // Status
    const [isUploading, setIsUploading] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isPublishing, setIsPublishing] = useState(false);
    const [publishLogs, setPublishLogs] = useState([]);
    const [error, setError] = useState(null);

    // Save Settings
    const saveSettings = () => {
        localStorage.setItem('groq_key', groqKey);
        localStorage.setItem('ftp_user', ftpUser);
        localStorage.setItem('ftp_pass', ftpPass);
        setShowSettings(false);
    };

    // 1. UPLOAD
    const handleFileUpload = async (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        setIsUploading(true);
        setError(null);

        const formData = new FormData();
        files.forEach(file => formData.append('files', file));

        try {
            const res = await fetch(`${API_BASE_URL}/upload`, {
                method: 'POST',
                body: formData
            });
            if (!res.ok) throw new Error("Upload failed");
            const data = await res.json();
            setSessionId(data.session_id);
            setImages(data.files); // Now array of {original, proxy}
            setStep(2);
        } catch (err) {
            setError(err.message);
        } finally {
            setIsUploading(false);
        }
    };

    // 2. ANALYZE (Async Polling Pattern)
    const handleAnalyze = async () => {
        if (!groqKey) {
            setShowSettings(true);
            return;
        }

        setIsAnalyzing(true);
        setError(null);

        try {
            // 1. Start Job
            const startRes = await fetch(`${API_BASE_URL}/analyze`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: sessionId,
                    api_key: groqKey,
                    context_map: contextMap
                })
            });

            if (!startRes.ok) {
                const errData = await startRes.json().catch(() => ({}));
                throw new Error(errData.detail || `Analysis start failed: ${startRes.status}`);
            }

            // 2. Poll for Status
            const pollInterval = 2000;
            const maxAttempts = 300; // 10 minutes max
            let attempts = 0;

            while (attempts < maxAttempts) {
                await new Promise(r => setTimeout(r, pollInterval));
                attempts++;

                const statusRes = await fetch(`${API_BASE_URL}/analyze/${sessionId}`);
                if (!statusRes.ok) throw new Error("Status check failed");

                const statusData = await statusRes.json();

                if (statusData.status === 'completed') {
                    setMetadata(statusData.results);
                    setStep(3);
                    return; // Success
                } else if (statusData.status === 'failed') {
                    throw new Error(statusData.error || "Analysis job failed on server");
                }
                // If 'processing', loop continues
            }

            throw new Error("Analysis timed out (client-side polling limit reached)");

        } catch (err) {
            console.error(err);
            setError(err.message);
        } finally {
            setIsAnalyzing(false);
        }
    };

    // 3. EDIT
    const updateMetadata = (index, field, value) => {
        const newMeta = [...metadata];
        newMeta[index] = { ...newMeta[index], [field]: value };
        setMetadata(newMeta);
    };

    // 4. PUBLISH (Embed + Upload)
    const handlePublish = async () => {
        if (!ftpUser || !ftpPass) {
            setShowSettings(true);
            return;
        }

        setIsPublishing(true);
        setPublishLogs(["Initiating process..."]);
        setError(null);

        try {
            const res = await fetch(`${API_BASE_URL}/embed-and-upload`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: sessionId,
                    project_name: "Upload_Batch",
                    metadata: metadata.map(m => {
                        // Find original filename corresponding to this proxy (if m.filename is proxy)
                        // The analysis returns result with proxy filename.
                        // We need to send ORIGINAL filename to backend for embedding.
                        const imgObj = images.find(img => img.proxy === m.filename);
                        return {
                            ...m,
                            filename: imgObj ? imgObj.original : m.filename
                        };
                    }),
                    ftp_user: ftpUser,
                    ftp_pass: ftpPass
                })
            });

            const data = await res.json();

            if (data.status === 'completed') {
                const logs = [
                    ...data.uploaded.map(f => `[SUCCESS] Uploaded: ${f}`),
                    ...data.upload_errors.map(e => `[FTP ERROR] ${e}`),
                    ...data.embed_errors.map(e => `[EMBED ERROR] ${e}`)
                ];
                if (logs.length === 0) logs.push("Process complete (Likely no files or all errors silent).");
                setPublishLogs(logs);
            } else {
                setPublishLogs([`[ERROR] ${data.error}`]);
            }

        } catch (err) {
            setError(err.message);
            setPublishLogs(prev => [...prev, `[CRITICAL] ${err.message}`]);
        } finally {
            setIsPublishing(false);
        }
    };

    // --- RENDERERS ---

    const renderStep1_Upload = () => (
        <div className="flex flex-col items-center justify-center min-h-[50vh] animate-in fade-in">
            <div className="w-full max-w-xl p-10 border-2 border-dashed border-slate-300 rounded-2xl bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer relative text-center group">
                <input
                    type="file"
                    multiple
                    accept="image/*"
                    onChange={handleFileUpload}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
                <div className="flex flex-col items-center group-hover:scale-105 transition-transform duration-200 pointer-events-none">
                    <div className="p-4 bg-blue-100 text-blue-600 rounded-full mb-4">
                        <UploadCloud className="w-10 h-10" />
                    </div>
                    <h3 className="text-xl font-semibold text-slate-800 mb-2">Drop images here</h3>
                    <p className="text-slate-500">or click to browse</p>
                </div>
            </div>
            {isUploading && (
                <div className="mt-8 flex items-center gap-2 text-blue-600 font-medium">
                    <Loader2 className="animate-spin w-5 h-5" /> Uploading assets...
                </div>
            )}
        </div>
    );

    const renderStep2_Context = () => (
        <div className="animate-in fade-in">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">Add Context</h2>
                    <p className="text-slate-500">Help the AI understand specific locations or details.</p>
                </div>
                <div className="flex gap-3">
                    <Button variant="secondary" onClick={() => setStep(1)}>Back</Button>
                    <Button
                        variant="gemini"
                        onClick={handleAnalyze}
                        disabled={isAnalyzing}
                        icon={isAnalyzing ? Loader2 : Sparkles}
                        className={isAnalyzing ? "animate-pulse" : ""}
                    >
                        {isAnalyzing ? "Analyzing..." : "Analyze Batch"}
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {images.map((imgObj) => (
                    <div key={imgObj.proxy} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden group">
                        <div className="aspect-square bg-slate-100 relative overflow-hidden">
                            <img
                                src={`${API_BASE_URL}/temp/${sessionId}/proxies/${imgObj.proxy}`}
                                alt={imgObj.original}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                        </div>
                        <div className="p-3">
                            <p className="text-xs font-mono text-slate-400 mb-2 truncate" title={imgObj.original}>{imgObj.original}</p>
                            <input
                                type="text"
                                placeholder="E.g. Eiffel Tower, Sunset..."
                                className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-purple-200 outline-none"
                                value={contextMap[imgObj.proxy] || ''}
                                onChange={(e) => setContextMap({ ...contextMap, [imgObj.proxy]: e.target.value })}
                            />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );

    const renderStep3_Review = () => (
        <div className="animate-in fade-in">
            <div className="flex justify-between items-center mb-6 sticky top-4 z-30 bg-white/80 backdrop-blur-md p-4 rounded-xl border border-white/20 shadow-sm">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">Review Metadata</h2>
                    <p className="text-slate-500">Edit titles and keywords before publishing.</p>
                </div>
                <div className="flex gap-3">
                    <Button variant="secondary" onClick={() => setStep(2)}>Back</Button>
                    <Button variant="primary" onClick={() => setStep(4)} icon={ArrowRight}>Proceed to Publish</Button>
                </div>
            </div>

            <div className="space-y-4">
                {metadata.map((item, idx) => (
                    <div key={idx} className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex gap-6">
                        <div className="w-48 h-48 bg-slate-100 rounded-lg overflow-hidden flex-shrink-0">
                            <img
                                src={`${API_BASE_URL}/temp/${sessionId}/proxies/${item.filename}`}
                                alt={item.filename}
                                className="w-full h-full object-cover"
                            />
                        </div>
                        <div className="flex-1 space-y-4">
                            <div className="flex gap-4">
                                <div className="flex-1">
                                    <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Title</label>
                                    <input
                                        value={item.title}
                                        onChange={(e) => updateMetadata(idx, 'title', e.target.value)}
                                        className="w-full font-medium text-slate-800 border-b border-slate-200 focus:border-blue-500 outline-none py-1 transition-colors"
                                    />
                                </div>
                                <div className="w-48">
                                    <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Category</label>
                                    <input
                                        value={item.category}
                                        onChange={(e) => updateMetadata(idx, 'category', e.target.value)}
                                        className="w-full text-sm text-slate-600 border-b border-slate-200 focus:border-blue-500 outline-none py-1"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Description</label>
                                <textarea
                                    value={item.description}
                                    onChange={(e) => updateMetadata(idx, 'description', e.target.value)}
                                    rows={2}
                                    className="w-full text-sm text-slate-600 border border-slate-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-100 outline-none resize-none"
                                />
                            </div>

                            <div>
                                <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Keywords</label>
                                <textarea
                                    value={item.keywords}
                                    onChange={(e) => updateMetadata(idx, 'keywords', e.target.value)}
                                    rows={2}
                                    className="w-full text-xs font-mono text-slate-500 border border-slate-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-100 outline-none resize-none bg-slate-50"
                                />
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );

    const renderStep4_Publish = () => (
        <div className="animate-in fade-in max-w-4xl mx-auto text-center py-10">
            <h2 className="text-3xl font-bold text-slate-800 mb-2">Publish to Stock</h2>
            <p className="text-slate-500 mb-10">
                This will embed the metadata into your files and upload them via FTP to Shutterstock.
            </p>

            {publishLogs.length === 0 && !isPublishing ? (
                <Button onClick={handlePublish} size="lg" variant="success" icon={Server} className="mx-auto scale-125">
                    Start Processing
                </Button>
            ) : (
                <div className="bg-slate-900 rounded-xl overflow-hidden shadow-2xl text-left font-mono text-sm">
                    <div className="bg-slate-950 px-4 py-2 border-b border-slate-800 flex justify-between items-center text-slate-400">
                        <span>Console Output</span>
                        {isPublishing && <Loader2 className="w-4 h-4 animate-spin" />}
                    </div>
                    <div className="p-6 h-64 overflow-y-auto space-y-2">
                        {publishLogs.map((log, i) => (
                            <div key={i} className={`
                                ${log.includes('[SUCCESS]') ? 'text-emerald-400' :
                                    log.includes('[ERROR]') ? 'text-red-400' : 'text-slate-300'}
                             `}>
                                <span className="text-slate-600 mr-2">$</span> {log}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {!isPublishing && publishLogs.length > 0 && (
                <div className="mt-8">
                    <Button variant="secondary" onClick={() => { setStep(1); setImages([]); setMetadata([]); setSessionId(null); setPublishLogs([]); }}>
                        All Done - Start New Batch
                    </Button>
                </div>
            )}
        </div>
    );

    return (
        <div className="min-h-screen bg-slate-50/50 pb-20">
            {/* Header */}
            <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="bg-blue-600 p-2 rounded-lg text-white">
                        <ImageIcon className="w-6 h-6" />
                    </div>
                    <h1 className="font-bold text-xl text-slate-800 tracking-tight">ShutterStacker <span className="text-blue-600 font-light">V2 VPS</span></h1>
                </div>
                <Button variant="ghost" onClick={() => setShowSettings(true)} icon={Settings}>Settings</Button>
            </header>

            {/* Error Banner */}
            {error && (
                <div className="max-w-5xl mx-auto mt-6 bg-red-50 text-red-600 px-4 py-3 rounded-lg border border-red-100 flex items-center shadow-sm">
                    <AlertCircle className="w-5 h-5 mr-3" />
                    {error}
                </div>
            )}

            {/* Main Content */}
            <main className="max-w-6xl mx-auto p-6">
                {step === 1 && renderStep1_Upload()}
                {step === 2 && renderStep2_Context()}
                {step === 3 && renderStep3_Review()}
                {step === 4 && renderStep4_Publish()}
            </main>

            {/* Settings Modal */}
            <Modal isOpen={showSettings} onClose={() => setShowSettings(false)} title="Settings">
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Groq API Key</label>
                        <div className="relative">
                            <Key className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                            <input
                                type="password"
                                value={groqKey}
                                onChange={e => setGroqKey(e.target.value)}
                                className="w-full pl-9 px-3 py-2 border rounded-lg"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">FTP Username</label>
                        <div className="relative">
                            <User className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                            <input
                                value={ftpUser}
                                onChange={e => setFtpUser(e.target.value)}
                                className="w-full pl-9 px-3 py-2 border rounded-lg"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">FTP Password</label>
                        <div className="relative">
                            <Lock className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                            <input
                                type="password"
                                value={ftpPass}
                                onChange={e => setFtpPass(e.target.value)}
                                className="w-full pl-9 px-3 py-2 border rounded-lg"
                            />
                        </div>
                    </div>
                    <div className="pt-4 flex justify-end">
                        <Button onClick={saveSettings}>Save Credentials</Button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
