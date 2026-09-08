/**
 * Observation Bot Panel
 * 
 * Admin component for viewing system observations, feedback, and insights.
 * 
 * Usage:
 *   <ObservationBotPanel />
 */

import { useState, useEffect } from 'react';
import { observationBot } from '@/lib/observationBot';
import { useT } from '@/lib/i18n';

interface Tab {
  id: string;
  label: string;
  count?: number;
}

export default function ObservationBotPanel() {
  const { t } = useT();
  const [activeTab, setActiveTab] = useState('overview');
  const [report, setReport] = useState('');
  const [actions, setActions] = useState<any[]>([]);
  const [errors, setErrors] = useState<any[]>([]);
  const [feedback, setFeedback] = useState<any[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = () => {
    setReport(observationBot.generateReport());
    setActions(observationBot.getActions().slice(-50).reverse());
    setErrors(observationBot.getErrors().slice(-50).reverse());
    setFeedback(observationBot.getFeedback().reverse());
  };

  const tabs: Tab[] = [
    { id: 'overview', label: t('overview') || 'Overview' },
    { id: 'actions', label: t('actions') || 'Actions', count: actions.length },
    { id: 'errors', label: t('errors') || 'Errors', count: errors.length },
    { id: 'feedback', label: t('feedback') || 'Feedback', count: feedback.length },
  ];

  const handleExport = () => {
    const data = observationBot.exportData();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `observation-bot-export-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClear = () => {
    if (confirm(t('confirm_clear') || 'Clear all observation data?')) {
      observationBot.clearData();
      loadData();
    }
  };

  return (
    <div className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-bold">
          {t('observation_bot') || '🔍 Observation Bot'}
        </h2>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            {t('export') || 'Export'}
          </button>
          <button
            onClick={loadData}
            className="px-3 py-1 text-sm bg-gray-500 text-white rounded hover:bg-gray-600"
          >
            {t('refresh') || 'Refresh'}
          </button>
          <button
            onClick={handleClear}
            className="px-3 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600"
          >
            {t('clear') || 'Clear'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b mb-4">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium ${
              activeTab === tab.id
                ? 'border-b-2 border-blue-500 text-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className="ml-1 px-2 py-0.5 text-xs bg-gray-200 rounded-full">
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="min-h-[400px]">
        {activeTab === 'overview' && (
          <pre className="text-sm font-mono whitespace-pre-wrap bg-gray-50 dark:bg-gray-900 p-4 rounded">
            {report}
          </pre>
        )}

        {activeTab === 'actions' && (
          <div className="space-y-2">
            {actions.length === 0 ? (
              <p className="text-gray-500 text-center py-8">
                {t('no_actions') || 'No actions recorded yet'}
              </p>
            ) : (
              actions.map(action => (
                <div
                  key={action.id}
                  className="p-3 bg-gray-50 dark:bg-gray-900 rounded text-sm"
                >
                  <div className="flex justify-between">
                    <span className="font-mono text-blue-600">{action.type}</span>
                    <span className="text-gray-400 text-xs">
                      {new Date(action.timestamp).toLocaleString()}
                    </span>
                  </div>
                  {action.data && (
                    <pre className="mt-1 text-xs text-gray-600 overflow-x-auto">
                      {JSON.stringify(action.data, null, 2)}
                    </pre>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'errors' && (
          <div className="space-y-2">
            {errors.length === 0 ? (
              <p className="text-gray-500 text-center py-8">
                {t('no_errors') || 'No errors recorded ✓'}
              </p>
            ) : (
              errors.map(error => (
                <div
                  key={error.id}
                  className="p-3 bg-red-50 dark:bg-red-900/20 rounded text-sm"
                >
                  <div className="flex justify-between">
                    <span className="font-mono text-red-600">{error.type}</span>
                    <span className="text-gray-400 text-xs">
                      {new Date(error.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-1 text-red-700">{error.message}</p>
                  {error.context && (
                    <pre className="mt-1 text-xs text-gray-600 overflow-x-auto">
                      {JSON.stringify(error.context, null, 2)}
                    </pre>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'feedback' && (
          <div className="space-y-2">
            {feedback.length === 0 ? (
              <p className="text-gray-500 text-center py-8">
                {t('no_feedback') || 'No feedback yet'}
              </p>
            ) : (
              feedback.map(item => (
                <div
                  key={item.id}
                  className={`p-3 rounded text-sm ${
                    item.resolved
                      ? 'bg-green-50 dark:bg-green-900/20'
                      : 'bg-yellow-50 dark:bg-yellow-900/20'
                  }`}
                >
                  <div className="flex justify-between">
                    <span className="font-mono text-xs px-2 py-0.5 bg-gray-200 rounded">
                      {item.category}
                    </span>
                    <span className="text-gray-400 text-xs">
                      {new Date(item.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-1">{item.message}</p>
                  {item.screen && (
                    <p className="mt-1 text-xs text-gray-500">
                      Screen: {item.screen}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
