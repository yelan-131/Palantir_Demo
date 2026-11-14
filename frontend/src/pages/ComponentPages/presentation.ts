import type {PageDefinition, PageWidget} from './model';
export interface ContainerPresentation { surface: 'plain'|'soft'|'card'; background: string|null; border: 'none'|'light'|'strong'; shadow: 'none'|'soft'; radius: number; padding: number }
export interface HeaderPresentation { visible: boolean; titleVisible: boolean; descriptionVisible: boolean; actionsVisible: boolean; layout: 'inline'|'stack'; divider: boolean; padding: number }
export interface ContentPresentation { density: 'compact'|'standard'|'comfortable'; gap: number; innerSurface: 'plain'|'soft'|'card'; innerTitles: boolean; separators: boolean; overflow: 'auto'|'hidden' }
export interface ComponentPresentation { container?: Partial<ContainerPresentation>|null; header?: Partial<HeaderPresentation>|null; content?: Partial<ContentPresentation>|null }
export interface ResolvedPresentation { container: ContainerPresentation; header: HeaderPresentation; content: ContentPresentation }
export const presentationDefaults: ResolvedPresentation = {
  container: {surface:'card',background:null,border:'light',shadow:'soft',radius:12,padding:16},
  header: {visible:true,titleVisible:true,descriptionVisible:true,actionsVisible:true,layout:'inline',divider:true,padding:16},
  content: {density:'standard',gap:12,innerSurface:'card',innerTitles:true,separators:true,overflow:'auto'},
};
const defined = <T extends object>(v?: Partial<T>|null): Partial<T> => Object.fromEntries(Object.entries(v||{}).filter(([key,value])=>value!==undefined&&(value!==null||key==='background'))) as Partial<T>;
/** Missing new sections retain the old serialized appearance; false and zero are explicit values. */
export function resolvePresentation(page: Pick<PageDefinition,'style'>, widget: Pick<PageWidget,'appearance'|'presentation'> & {type?:PageWidget['type']}): ResolvedPresentation {
  const a=widget.appearance||{}, s=page.style||{};
  const surface=a.surface??s.componentSurface??(widget.type==='workspace'?'plain':'card');
  const legacy:ResolvedPresentation={
    container:{...presentationDefaults.container,surface,border:surface==='card'?(s.cardBorder??'light'):'none',shadow:surface==='card'?'soft':'none',radius:a.radius??s.cardRadius??12,padding:16},
    header:{...presentationDefaults.header,titleVisible:a.showTitle!==false,descriptionVisible:a.showSubtitle!==false,divider:a.headingStyle!=='inline'},
    content:{...presentationDefaults.content,innerSurface:widget.type==='workspace'?'plain':'card',density:s.tableDensity??'standard'},
  };
  const defaults=s.componentDefaults, own=widget.presentation;
  return {
    container:{...legacy.container,...defined(defaults?.container),...defined(own?.container)},
    header:{...legacy.header,...defined(defaults?.header),...defined(own?.header)},
    content:{...legacy.content,...defined(defaults?.content),...defined(own?.content)},
  };
}
