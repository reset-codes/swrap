'use client';

import * as React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Copy, ExternalLink, Globe, Sparkles } from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';

interface PublishSuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  publicUrl: string;
  slug: string;
  formTitle: string;
}

export function PublishSuccessModal({
  isOpen,
  onClose,
  publicUrl,
  slug,
  formTitle,
}: PublishSuccessModalProps) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!isOpen) {
      setCopied(false);
    }
  }, [isOpen]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <AnimatePresence>
        {isOpen && (
          <DialogPrimitive.Portal forceMount>
            {/* Glassmorphic Backdrop overlay */}
            <DialogPrimitive.Overlay asChild>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-md"
              />
            </DialogPrimitive.Overlay>

            {/* Glassmorphic Content Card */}
            <DialogPrimitive.Content asChild>
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                transition={{ type: 'spring', duration: 0.5, bounce: 0.2 }}
                className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-white/20 bg-white/70 p-8 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/80 focus:outline-none"
              >
                {/* Radial Glowing Accent */}
                <div className="absolute -left-12 -top-12 -z-10 h-44 w-44 rounded-full bg-cyan-400/20 blur-3xl dark:bg-cyan-500/10" />
                <div className="absolute -right-12 -bottom-12 -z-10 h-44 w-44 rounded-full bg-violet-400/20 blur-3xl dark:bg-violet-500/10" />

                {/* Animated Celebration Icon */}
                <div className="flex flex-col items-center text-center">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', delay: 0.2, stiffness: 200, damping: 10 }}
                    className="relative flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-tr from-cyan-500 to-blue-600 shadow-lg"
                  >
                    <Globe className="h-8 w-8 text-white animate-pulse" />
                    <motion.div
                      animate={{ scale: [1, 1.2, 1] }}
                      transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
                      className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-yellow-400 shadow-md"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-slate-900" />
                    </motion.div>
                  </motion.div>

                  <h2 className="mt-6 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                    Live on Decentralized Web!
                  </h2>
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 max-w-sm">
                    Your form <span className="font-semibold text-slate-800 dark:text-slate-200">"{formTitle}"</span> is successfully stored on Walrus and fully certified.
                  </p>
                </div>

                {/* URL and Copy Section */}
                <div className="mt-8 space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    Public Link
                  </label>
                  <div className="relative flex items-center rounded-xl border border-slate-200 bg-white/50 p-1.5 backdrop-blur-sm dark:border-white/5 dark:bg-slate-950/40">
                    <input
                      type="text"
                      readOnly
                      value={publicUrl}
                      className="w-full bg-transparent px-3 py-2 text-sm font-medium text-slate-800 outline-none dark:text-slate-200"
                    />
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      onClick={handleCopy}
                      className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold transition-all ${
                        copied
                          ? 'bg-emerald-500 text-white shadow-emerald-500/20'
                          : 'bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200 shadow-md'
                      }`}
                    >
                      {copied ? (
                        <>
                          <Check className="h-3.5 w-3.5" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          Copy
                        </>
                      )}
                    </motion.button>
                  </div>
                </div>

                {/* Primary Action Buttons */}
                <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-end">
                  <DialogPrimitive.Close asChild>
                    <button className="w-full rounded-xl border border-slate-200 bg-white/40 px-5 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 dark:border-white/5 dark:bg-slate-800/40 dark:text-slate-300 dark:hover:bg-slate-800 transition-all sm:w-auto">
                      Back to Editor
                    </button>
                  </DialogPrimitive.Close>
                  <a
                    href={publicUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-cyan-500/20 hover:from-cyan-600 hover:to-blue-700 transition-all sm:w-auto"
                  >
                    Open Live Form
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </div>
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}
