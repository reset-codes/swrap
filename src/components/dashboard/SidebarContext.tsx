'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

interface SidebarContextType {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  toggle: () => void;
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  // Default to collapsed on desktop — shows icon rail without taking too much space
  const [isOpen, setIsOpen] = useState(false);

  // Persistence in localStorage
  useEffect(() => {
    const saved = localStorage.getItem('swrap-sidebar-open');
    if (saved !== null) {
      setIsOpen(saved === 'true');
    }
  }, []);

  const handleSetIsOpen = (value: boolean) => {
    setIsOpen(value);
    localStorage.setItem('swrap-sidebar-open', String(value));
  };

  const toggle = () => handleSetIsOpen(!isOpen);

  return (
    <SidebarContext.Provider value={{ isOpen, setIsOpen: handleSetIsOpen, toggle }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (context === undefined) {
    throw new Error('useSidebar must be used within a SidebarProvider');
  }
  return context;
}
