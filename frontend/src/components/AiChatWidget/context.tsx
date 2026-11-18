import { createContext, useContext, useMemo, useState, useRef, useCallback, type ReactNode } from 'react';

import type { BrowserPageAction, ComponentPageController, PageController } from './pageControls';
import type { DesignPreview } from './designPreview';

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
  designPreview?: { preview: DesignPreview; sessionId: string; messageId: string; runId?: string; returnTo: string };
  setDesignPreview: React.Dispatch<React.SetStateAction<AiWorkbenchContextValue['designPreview']>>;
  pageActions: BrowserPageAction[];
  enqueuePageAction: (action: BrowserPageAction) => void;
  registerComponentPageController: (code: string, controller: ComponentPageController) => () => void;
  getComponentPageController: (code: string) => ComponentPageController | undefined;
  componentPageContext?: { code: string; title: string };
  setComponentPageContext: (page?: { code: string; title: string }) => void;
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
  const [designPreview, setDesignPreview] = useState<AiWorkbenchContextValue['designPreview']>();
  const [knowledgeContext, setKnowledgeContext] = useState<AiKnowledgeContext | undefined>();
  const [pageActions, setPageActions] = useState<BrowserPageAction[]>([]);
  const [componentPageContext, setComponentPageContext] = useState<{ code: string; title: string }>();
  const componentControllers = useRef(new Map<string, ComponentPageController>());
  const [controllerVersion, setControllerVersion] = useState(0);
  const [designerContext, setDesignerContext] = useState<Record<string, unknown>>();
  const controllers = useRef(new Map<number, PageController>());
  const enqueuePageAction = useCallback((action: BrowserPageAction) => {
    if (action.type === 'application_navigation') {
      const validName = (value: unknown) => typeof value === 'string' && value.trim().length > 0 && value.length <= 100;
      if (!action.id || (action.action === 'open_application' ? !validName(action.application)
        : action.action !== 'open_page' || !validName(action.page) || (action.application !== undefined && !validName(action.application)))) return;
      setPageActions(current => current.some(item => item.id === action.id) ? current : [...current, action]);
      return;
    }
    if (action.type === 'component_page') {
      if (!action.id || !action.page_code || !['inspect', 'apply'].includes(action.action)) return;
      setPageActions(current => current.some(item => item.id === action.id) ? current : [...current, action]);
      return;
    }
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
  const registerComponentPageController = useCallback((code: string, controller: ComponentPageController) => {
    componentControllers.current.set(code, controller);
    return () => {
      if (componentControllers.current.get(code) === controller) componentControllers.current.delete(code);
    };
  }, []);
  const getComponentPageController = useCallback((code: string) => componentControllers.current.get(code), []);
  const value = useMemo(() => ({ designPreview, setDesignPreview, knowledgeContext, setKnowledgeContext, pageActions, enqueuePageAction, finishPageAction,
    registerPageController, getPageController, controllerVersion, designerContext, setDesignerContext,
    componentPageContext, setComponentPageContext, registerComponentPageController, getComponentPageController }),
    [designPreview, knowledgeContext, pageActions, enqueuePageAction, finishPageAction, registerPageController, getPageController, controllerVersion, designerContext,
      componentPageContext, registerComponentPageController, getComponentPageController]);
  return <AiWorkbenchContext.Provider value={value}>{children}</AiWorkbenchContext.Provider>;
}

export function useAiWorkbench() {
  const context = useContext(AiWorkbenchContext);
  if (!context) {
    throw new Error('useAiWorkbench must be used inside AiWorkbenchProvider');
  }
  return context;
}
