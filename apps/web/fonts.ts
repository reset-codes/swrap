/**
 * Font configuration for the POC UI.
 *
 * This is the ONLY file allowed to import from `next/font/google`.
 * All other files must import `appFont` from here.
 *
 * Requirements: R19.3
 */
import { Geist } from 'next/font/google';

export const appFont = Geist({ subsets: ['latin'], variable: '--font-geist' });
