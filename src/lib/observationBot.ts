/**
 * John — System Monitor & Feedback Collector
 * 
 * Monitors the application for:
 * - User actions and navigation patterns
 * - Error occurrences
 * - Performance issues
 * - Data inconsistencies
 * - Feedback collection
 * 
 * Usage:
 *   import { john } from '@/lib/observationBot';
 *   john.trackAction('customer_created', { customerId: '123' });
 *   john.trackError('payment_failed', error);
 *   john.logFeedback('The search is slow', 'usability');
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

// Incident reporting guard — prevents recursive incident generation
let _incidentReportingDisabled = false;

// Component mapping: error types to system components
const COMPONENT_MAP: Record<string, string> = {
  unhandled_error: 'ui',
  unhandled_promise_rejection: 'ui',
  payment_failed: 'payments',
  sale_error: 'sales',
  inventory_error: 'inventory',
  customer_error: 'customers',
  auth_error: 'auth',
  sync_error: 'ui',
  network_error: 'infrastructure',
  rpc_error: 'infrastructure',
  default: 'ui',
};

// Severity mapping: error types to severity levels
const SEVERITY_MAP: Record<string, string> = {
  unhandled_error: 'high',
  unhandled_promise_rejection: 'high',
  payment_failed: 'critical',
  sale_error: 'critical',
  inventory_error: 'high',
  auth_error: 'critical',
  network_error: 'medium',
  rpc_error: 'high',
  default: 'medium',
};

class John {
  private actions: trackedAction[] = [];
  private errors: TrackedError[] = [];
  private feedback: Feedback[] = [];
  private performance: PerformanceMetric[] = [];
  private sessionId: string;
  private userId?: string;
  public name = 'John';

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
    
    console.log(`[John] Action: ${type}`, data);
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
    
    console.error(`[John] Error: ${type}`, error);

    // Fire-and-forget: report to server incident system
    // Never block the application. Never generate recursive incidents.
    this.reportToIncidentSystem(type, error, context).catch(() => {});
  }

  /**
   * Report error to server incident system via record_incident RPC.
   * Fire-and-forget: failures are silently ignored.
   * Prevents recursive incident generation.
   */
  private async reportToIncidentSystem(
    type: string,
    error: Error | string,
    context?: Record<string, any>
  ): Promise<void> {
    // Guard: prevent recursive incident reporting
    if (_incidentReportingDisabled) return;

    try {
      // Dynamic import to avoid circular dependencies and bundle bloat
      const { supabase } = await import('@/lib/supabase');

      const message = typeof error === 'string' ? error : error.message;
      const stack = error instanceof Error ? error.stack : undefined;
      const component = COMPONENT_MAP[type] || COMPONENT_MAP.default;
      const severity = SEVERITY_MAP[type] || SEVERITY_MAP.default;

      // Build sanitized context (only allowlisted fields)
      const sanitizedContext: Record<string, string> = {};
      if (context?.screen) sanitizedContext.screen = String(context.screen).slice(0, 100);
      if (context?.entity_type) sanitizedContext.entity_type = String(context.entity_type).slice(0, 50);
      if (context?.entity_id) sanitizedContext.entity_id = String(context.entity_id).slice(0, 100);
      if (context?.operation) sanitizedContext.operation = String(context.operation).slice(0, 50);

      // Call record_incident RPC — SECURITY DEFINER handles sanitization server-side
      const { error: rpcError } = await supabase.rpc('record_incident', {
        p_type: 'error',
        p_severity: severity,
        p_source: 'client',
        p_component: component,
        p_message: message,
        p_context: sanitizedContext,
        p_stack_trace: stack || null,
        p_user_action: context?.screen ? `screen:${context.screen}` : null,
      });

      // If RPC fails, silently ignore — do NOT generate another incident
      if (rpcError) {
        console.warn('[John] Incident report failed (non-critical):', rpcError.message);
      }
    } catch {
      // Silently ignore all errors — never break the application
      // Never generate recursive incidents
    }
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
    
    console.log(`[John] Feedback: ${category}`, message);
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
    console.log('[John] Data cleared');
  }
}

// Singleton instance
export const john = new John();

// Backward compatibility alias
export const observationBot = john;

// Convenience exports for tracking common patterns
export const trackNavigation = (from: string, to: string) => {
  john.trackAction('navigation', { from, to });
};

export const trackUserAction = (action: string, data?: Record<string, any>) => {
  john.trackAction(`user_${action}`, data);
};

export const trackSystemError = (error: Error | string, context?: Record<string, any>) => {
  john.trackError('system_error', error, context);
};

export const trackPerformance = (name: string, startTime: number) => {
  const duration = Date.now() - startTime;
  john.trackPerformance(name, duration);
};
