/**
 * Observation Bot — System Monitor & Feedback Collector
 * 
 * Monitors the application for:
 * - User actions and navigation patterns
 * - Error occurrences
 * - Performance issues
 * - Data inconsistencies
 * - Feedback collection
 * 
 * Usage:
 *   import { observationBot } from '@/lib/observationBot';
 *   observationBot.trackAction('customer_created', { customerId: '123' });
 *   observationBot.trackError('payment_failed', error);
 *   observationBot.logFeedback('The search is slow', 'usability');
 */

interface trackedAction {
  id: string;
  type: string;
  timestamp: Date;
  userId?: string;
  data?: Record<string, any>;
  duration?: number;
}

interface TrackedError {
  id: string;
  type: string;
  message: string;
  timestamp: Date;
  userId?: string;
  stack?: string;
  context?: Record<string, any>;
}

interface Feedback {
  id: string;
  category: 'usability' | 'bug' | 'feature' | 'performance' | 'other';
  message: string;
  timestamp: Date;
  userId?: string;
  screen?: string;
  resolved?: boolean;
}

interface PerformanceMetric {
  id: string;
  name: string;
  value: number;
  unit: string;
  timestamp: Date;
  context?: Record<string, any>;
}

class ObservationBot {
  private actions: trackedAction[] = [];
  private errors: TrackedError[] = [];
  private feedback: Feedback[] = [];
  private performance: PerformanceMetric[] = [];
  private sessionId: string;
  private userId?: string;

  constructor() {
    this.sessionId = this.generateId();
    this.loadFromStorage();
    this.setupErrorListener();
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem('observation_bot_data');
      if (stored) {
        const data = JSON.parse(stored);
        this.actions = data.actions || [];
        this.errors = data.errors || [];
        this.feedback = data.feedback || [];
        this.performance = data.performance || [];
      }
    } catch (e) {
      console.warn('Failed to load observation bot data:', e);
    }
  }

  private saveToStorage(): void {
    try {
      localStorage.setItem('observation_bot_data', JSON.stringify({
        actions: this.actions.slice(-1000), // Keep last 1000
        errors: this.errors.slice(-500),
        feedback: this.feedback,
        performance: this.performance.slice(-500)
      }));
    } catch (e) {
      console.warn('Failed to save observation bot data:', e);
    }
  }

  private setupErrorListener(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('error', (event) => {
        this.trackError('unhandled_error', event.error);
      });
      window.addEventListener('unhandledrejection', (event) => {
        this.trackError('unhandled_promise_rejection', event.reason);
      });
    }
  }

  // ─── Public Methods ──────────────────────────────────────────────────────

  setUserId(userId: string): void {
    this.userId = userId;
  }

  trackAction(type: string, data?: Record<string, any>, duration?: number): void {
    const action: trackedAction = {
      id: this.generateId(),
      type,
      timestamp: new Date(),
      userId: this.userId,
      data,
      duration
    };
    this.actions.push(action);
    this.saveToStorage();
    
    console.log(`[ObservationBot] Action: ${type}`, data);
  }

  trackError(type: string, error: Error | string, context?: Record<string, any>): void {
    const trackedError: TrackedError = {
      id: this.generateId(),
      type,
      message: typeof error === 'string' ? error : error.message,
      timestamp: new Date(),
      userId: this.userId,
      stack: error instanceof Error ? error.stack : undefined,
      context
    };
    this.errors.push(trackedError);
    this.saveToStorage();
    
    console.error(`[ObservationBot] Error: ${type}`, error);
  }

  logFeedback(message: string, category: Feedback['category'] = 'other', screen?: string): void {
    const feedback: Feedback = {
      id: this.generateId(),
      category,
      message,
      timestamp: new Date(),
      userId: this.userId,
      screen,
      resolved: false
    };
    this.feedback.push(feedback);
    this.saveToStorage();
    
    console.log(`[ObservationBot] Feedback: ${category}`, message);
  }

  trackPerformance(name: string, value: number, unit: string = 'ms', context?: Record<string, any>): void {
    const metric: PerformanceMetric = {
      id: this.generateId(),
      name,
      value,
      unit,
      timestamp: new Date(),
      context
    };
    this.performance.push(metric);
    this.saveToStorage();
  }

  // ─── Reporting ───────────────────────────────────────────────────────────

  getActions(type?: string): trackedAction[] {
    if (type) {
      return this.actions.filter(a => a.type === type);
    }
    return [...this.actions];
  }

  getErrors(type?: string): TrackedError[] {
    if (type) {
      return this.errors.filter(e => e.type === type);
    }
    return [...this.errors];
  }

  getFeedback(category?: Feedback['category']): Feedback[] {
    if (category) {
      return this.feedback.filter(f => f.category === category);
    }
    return [...this.feedback];
  }

  getPerformance(name?: string): PerformanceMetric[] {
    if (name) {
      return this.performance.filter(p => p.name === name);
    }
    return [...this.performance];
  }

  // ─── Summary Report ──────────────────────────────────────────────────────

  generateReport(): string {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const recentActions = this.actions.filter(a => a.timestamp > oneDayAgo);
    const recentErrors = this.errors.filter(e => e.timestamp > oneDayAgo);
    const unresolvedFeedback = this.feedback.filter(f => !f.resolved);

    const actionTypes = recentActions.reduce((acc, a) => {
      acc[a.type] = (acc[a.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const errorTypes = recentErrors.reduce((acc, e) => {
      acc[e.type] = (acc[e.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const feedbackByCategory = unresolvedFeedback.reduce((acc, f) => {
      acc[f.category] = (acc[f.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return `
# Observation Bot Report
Generated: ${now.toISOString()}
Session: ${this.sessionId}

## Summary (Last 24 Hours)
- Total Actions: ${recentActions.length}
- Total Errors: ${recentErrors.length}
- Unresolved Feedback: ${unresolvedFeedback.length}

## Action Breakdown
${Object.entries(actionTypes)
  .sort((a, b) => b[1] - a[1])
  .map(([type, count]) => `- ${type}: ${count}`)
  .join('\n') || 'No actions recorded'}

## Error Breakdown
${Object.entries(errorTypes)
  .sort((a, b) => b[1] - a[1])
  .map(([type, count]) => `- ${type}: ${count}`)
  .join('\n') || 'No errors recorded'}

## Feedback by Category
${Object.entries(feedbackByCategory)
  .sort((a, b) => b[1] - a[1])
  .map(([cat, count]) => `- ${cat}: ${count}`)
  .join('\n') || 'No unresolved feedback'}

## Unresolved Feedback Items
${unresolvedFeedback
  .slice(0, 10)
  .map(f => `- [${f.category}] ${f.message} (${f.screen || 'unknown screen'})`)
  .join('\n') || 'None'}

## Performance Metrics (Last 24h)
${this.performance
  .filter(p => p.timestamp > oneDayAgo)
  .slice(-10)
  .map(p => `- ${p.name}: ${p.value}${p.unit}`)
  .join('\n') || 'No metrics recorded'}

## Scaling Insights
${this.generateScalingInsights()}
`;
  }

  private generateScalingInsights(): string {
    const insights: string[] = [];
    
    // Analyze action patterns
    const actionCounts = this.actions.reduce((acc, a) => {
      acc[a.type] = (acc[a.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const topActions = Object.entries(actionCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    if (topActions.length > 0) {
      insights.push('**Most Used Features:**');
      topActions.forEach(([type, count]) => {
        insights.push(`- ${type}: ${count} times`);
      });
    }

    // Analyze error patterns
    const errorCounts = this.errors.reduce((acc, e) => {
      acc[e.type] = (acc[e.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const topErrors = Object.entries(errorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    if (topErrors.length > 0) {
      insights.push('\n**Common Issues to Address:**');
      topErrors.forEach(([type, count]) => {
        insights.push(`- ${type}: ${count} occurrences`);
      });
    }

    // Performance insights
    if (this.performance.length > 0) {
      const avgPerformance = this.performance.reduce((acc, p) => {
        acc[p.name] = acc[p.name] || { total: 0, count: 0 };
        acc[p.name].total += p.value;
        acc[p.name].count += 1;
        return acc;
      }, {} as Record<string, { total: number; count: number }>);

      insights.push('\n**Performance Insights:**');
      Object.entries(avgPerformance).forEach(([name, stats]) => {
        const avg = stats.total / stats.count;
        insights.push(`- ${name}: avg ${avg.toFixed(2)}ms (${stats.count} samples)`);
      });
    }

    return insights.join('\n') || 'Collecting data...';
  }

  // ─── Export/Import ───────────────────────────────────────────────────────

  exportData(): string {
    return JSON.stringify({
      sessionId: this.sessionId,
      userId: this.userId,
      exportTime: new Date().toISOString(),
      actions: this.actions,
      errors: this.errors,
      feedback: this.feedback,
      performance: this.performance
    }, null, 2);
  }

  clearData(): void {
    this.actions = [];
    this.errors = [];
    this.feedback = [];
    this.performance = [];
    this.saveToStorage();
    console.log('[ObservationBot] Data cleared');
  }
}

// Singleton instance
export const observationBot = new ObservationBot();

// Convenience exports for tracking common patterns
export const trackNavigation = (from: string, to: string) => {
  observationBot.trackAction('navigation', { from, to });
};

export const trackUserAction = (action: string, data?: Record<string, any>) => {
  observationBot.trackAction(`user_${action}`, data);
};

export const trackSystemError = (error: Error | string, context?: Record<string, any>) => {
  observationBot.trackError('system_error', error, context);
};

export const trackPerformance = (name: string, startTime: number) => {
  const duration = Date.now() - startTime;
  observationBot.trackPerformance(name, duration);
};
