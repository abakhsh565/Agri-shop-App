/**
 * React Hook for Observation Bot
 * 
 * Provides easy integration of observation tracking in components.
 * 
 * Usage:
 *   const { trackAction, trackError, logFeedback } = useObservationBot();
 *   trackAction('button_clicked', { button: 'save' });
 */

import { useEffect, useCallback } from 'react';
import { observationBot } from '@/lib/observationBot';

interface UseObservationBotOptions {
  screenName?: string;
  userId?: string;
}

interface UseObservationBotReturn {
  trackAction: (type: string, data?: Record<string, any>) => void;
  trackError: (type: string, error: Error | string) => void;
  logFeedback: (message: string, category?: 'usability' | 'bug' | 'feature' | 'performance' | 'other') => void;
  trackPerformance: (name: string, startTime: number) => void;
}

export function useObservationBot(options: UseObservationBotOptions = {}): UseObservationBotReturn {
  const { screenName, userId } = options;

  useEffect(() => {
    if (userId) {
      observationBot.setUserId(userId);
    }
  }, [userId]);

  useEffect(() => {
    if (screenName) {
      observationBot.trackAction('screen_view', { screen: screenName });
    }
  }, [screenName]);

  const trackAction = useCallback((type: string, data?: Record<string, any>) => {
    observationBot.trackAction(type, { ...data, screen: screenName });
  }, [screenName]);

  const trackError = useCallback((type: string, error: Error | string) => {
    observationBot.trackError(type, error, { screen: screenName });
  }, [screenName]);

  const logFeedback = useCallback((message: string, category: 'usability' | 'bug' | 'feature' | 'performance' | 'other' = 'other') => {
    observationBot.logFeedback(message, category, screenName);
  }, [screenName]);

  const trackPerformance = useCallback((name: string, startTime: number) => {
    const duration = Date.now() - startTime;
    observationBot.trackPerformance(name, duration, 'ms', { screen: screenName });
  }, [screenName]);

  return {
    trackAction,
    trackError,
    logFeedback,
    trackPerformance
  };
}

export default useObservationBot;
