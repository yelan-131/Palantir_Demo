import { createContext, useContext, useMemo, useState, useRef, useCallback, type ReactNode } from 'react';

import type { PageAction, PageController } from './pageControls';

export type AiSurface = 'global' | 'knowledge';

export interface AiWorkbenchPanel {
  key: string;
  label: string;
  content: ReactNode;
}

export interface AiKnowledgeContext {
  surface: 'knowledge';
  documentId?: string;
  documentTitle?: string;
  documentSummary?: string;
  knowledgeMode?: string | number;
  panels: AiWorkbenchPanel[];
}

interface AiWorkbenchContextValue {
  pageActions: PageAction[];
  enqueuePageAction: (action: PageAction) => void;
  finishPageAction: (id: string) => void;
  registerPageController: (formId: number, controller: PageController) => () => void;
  getPageController: (formId: number) => PageController | undefined;
  controllerVersion: number;
  designerContext?: Record<string, unknown>;
  setDesignerContext: (state?: Record<string, unknown>) => void;
  knowledgeContext?: AiKnowledgeContext;
  setKnowledgeContext: (context?: AiKnowledgeContext) => void;
}

const AiWorkbenchContext = createContext<AiWorkbenchContextValue | undefined>(undefined);

export function AiWorkbenchProvider({ children }: { children: ReactNode }) {
  const [knowledgeContext, setKnowledgeContext] = useState<AiKnowledgeContext | undefined>();
  const [pageActions, setPageActions] = useState<PageAction[]>([]);
  const [controllerVersion, setControllerVersion] = useState(0);
  const [designerContext, setDesignerContext] = useState<Record<string, unknown>>();
  const controllers = useRef(new Map<number, PageController>());
  const enqueuePageAction = useCallback((action: PageAction) => {
    if (action.action === 'confirm_draft') return; // Only a user's final confirmation may invoke this local command.
    if (action.type !== 'form_designer' || !Number.isInteger(action.form_id) || action.form_id < 0 || !action.id) return;
    if (action.form_id === 0 && (!action.draft_id || !/^[a-f0-9]{32}$/.test(action.draft_id))) return;
    if (action.action === 'draft_new' && (action.form_id !== 0 || !Array.isArray(action.draft?.fields))) return;
    setPageActions(current => current.some(item => item.id === action.id) ? current : [...current, action]);
  }, []);
  const finishPageAction = useCallback((id: string) => setPageActions(current => current.filter(action => action.id !== id)), []);
  const registerPageController = useCallback((formId: number, controller: PageController) => {
    controllers.current.set(formId, controller);
    setControllerVersion(version => version + 1);
    return () => {
      if (controllers.current.get(formId) === controller) { controllers.current.delete(formId); setControllerVersion(version => version + 1); }
    };
  }, []);
  const getPageController = useCallback((formId: number) => controllers.current.get(formId), []);
  const value = useMemo(() => ({ knowledgeContext, setKnowledgeContext, pageActions, enqueuePageAction, finishPageAction,
    registerPageController, getPageController, controllerVersion, designerContext, setDesignerContext }),
    [knowledgeContext, pageActions, enqueuePageAction, finishPageAction, registerPageController, getPageController, controllerVersion, designerContext]);
  return <AiWorkbenchContext.Provider value={value}>{children}</AiWorkbenchContext.Provider>;
}

export function useAiWorkbench() {
  const context = useContext(AiWorkbenchContext);
  if (!context) {
    throw new Error('useAiWorkbench must be used inside AiWorkbenchProvider');
  }
  return context;
}
