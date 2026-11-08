import { useEffect, useMemo, useState } from "react";
import { Braces, ChevronDown, ChevronRight, CircleDot, FileCode2, Network, Package, RefreshCw } from "lucide-react";
import type { ModuleInfo } from "../types";
import {
  matchesNavigationScope,
  pathFromJavaUri,
  type HierarchyDirection,
  type JavaHierarchyNode,
  type JavaNavigationModel,
  type JavaNavigationScope,
  type JavaUsage,
} from "../language/java-navigation";
import { t } from "../i18n";

type Props = {
  model: JavaNavigationModel | null;
  loading: boolean;
  error: string;
  projectRoot: string;
  modules: ModuleInfo[];
  activeModuleId?: string;
  onRefresh: () => void;
  onNavigate: (path: string, line: number, column: number, endLine?: number, endColumn?: number) => void;
  onLoadChildren: (node: JavaHierarchyNode) => Promise<JavaHierarchyNode[]>;
};

const branchEmpty: Record<HierarchyDirection, string> = {
  incoming: "Keine eingehenden Aufrufe",
  outgoing: "Keine ausgehenden Aufrufe",
  supertypes: "Keine Obertypen",
  subtypes: "Keine Untertypen",
};

export function JavaNavigationPanel({
  model,
  loading,
  error,
  projectRoot,
  modules,
  activeModuleId,
  onRefresh,
  onNavigate,
  onLoadChildren,
}: Props) {
  const [scope, setScope] = useState<JavaNavigationScope>({
    moduleId: null,
    includeProduction: true,
    includeTests: true,
  });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [children, setChildren] = useState<Record<string, JavaHierarchyNode[]>>({});
  const [loadingNodes, setLoadingNodes] = useState<Set<string>>(new Set());
  const [openPackages, setOpenPackages] = useState<Set<string>>(new Set());
  const [openFiles, setOpenFiles] = useState<Set<string>>(new Set());

  useEffect(() => {
    setExpanded(new Set());
    setChildren({});
    setLoadingNodes(new Set());
    setOpenPackages(new Set(model?.usageGroups?.map((group) => group.packageName) || []));
    setOpenFiles(new Set(model?.usageGroups?.flatMap((group) => group.files.map((file) => file.path)) || []));
  }, [model?.id]);

  useEffect(() => {
    if (scope.moduleId && !modules.some((module) => module.id === scope.moduleId)) {
      setScope((current) => ({ ...current, moduleId: null }));
    }
  }, [modules, scope.moduleId]);

  const visibleUsageGroups = useMemo(() => (model?.usageGroups || []).map((group) => ({
    ...group,
    files: group.files.filter((file) => matchesNavigationScope(file.path, projectRoot, modules, scope)),
  })).filter((group) => group.files.length > 0).map((group) => ({
    ...group,
    count: group.files.reduce((sum, file) => sum + file.usages.length, 0),
  })), [model?.usageGroups, modules, projectRoot, scope]);

  const toggleSet = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, key: string) => {
    setter((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleNode = async (node: JavaHierarchyNode, nodeKey: string) => {
    if (expanded.has(nodeKey)) {
      toggleSet(setExpanded, nodeKey);
      return;
    }
    setExpanded((current) => new Set(current).add(nodeKey));
    if (children[nodeKey] || loadingNodes.has(nodeKey)) return;
    setLoadingNodes((current) => new Set(current).add(nodeKey));
    try {
      const loaded = await onLoadChildren(node);
      setChildren((current) => ({ ...current, [nodeKey]: loaded }));
    } finally {
      setLoadingNodes((current) => {
        const next = new Set(current);
        next.delete(nodeKey);
        return next;
      });
    }
  };

  const renderNode = (node: JavaHierarchyNode, parentKey: string, depth: number) => {
    const nodeKey = `${parentKey}/${node.id}`;
    const open = expanded.has(nodeKey);
    const nested = (children[nodeKey] || []).filter((child) =>
      matchesNavigationScope(pathFromJavaUri(child.item.uri), projectRoot, modules, scope));
    const position = node.item.selectionRange.start;
    return (
      <div className="java-hierarchy-node" key={nodeKey}>
        <div className="java-hierarchy-row" style={{ paddingLeft: `${Math.min(depth, 8) * 12 + 4}px` }}>
          <button
            className="hierarchy-toggle"
            aria-label={`${node.item.name} ${open ? "einklappen" : "ausklappen"}`}
            aria-expanded={open}
            onClick={() => void toggleNode(node, nodeKey)}
          >
            {loadingNodes.has(nodeKey) ? <RefreshCw size={12} className="spin" /> : open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          <button className="hierarchy-symbol" onClick={() => onNavigate(pathFromJavaUri(node.item.uri), position.line + 1, position.character + 1)}>
            {node.item.kind === 6 ? <Braces size={13} /> : <CircleDot size={12} />}
            <span><strong>{node.item.name}</strong>{node.item.detail && <small>{node.item.detail}</small>}</span>
          </button>
        </div>
        {open && (nested.length > 0
          ? <div role="group">{nested.map((child) => renderNode(child, nodeKey, depth + 1))}</div>
          : !loadingNodes.has(nodeKey) && <div className="hierarchy-empty-child" style={{ paddingLeft: `${Math.min(depth + 1, 8) * 12 + 24}px` }}>{t("Keine weiteren Treffer")}</div>)}
      </div>
    );
  };

  const navigateUsage = (usage: JavaUsage) => onNavigate(usage.path, usage.line, usage.column, usage.endLine, usage.endColumn);

  return (
    <div className="java-navigation-panel">
      <div className="sidebar-header">
        <span>{model?.kind === "usages" ? "VERWENDUNGEN" : "HIERARCHIE"}</span>
        <button className="icon-button" title={t("Aktualisieren")} aria-label={t("Navigation aktualisieren")} onClick={onRefresh} disabled={loading || !model}>
          <RefreshCw size={13} className={loading ? "spin" : ""} />
        </button>
      </div>
      <div className="java-navigation-filters" aria-label={t("Navigationsfilter")}>
        <select
          aria-label={t("Projekt- oder Modulfilter")}
          value={scope.moduleId || "project"}
          onChange={(event) => setScope((current) => ({ ...current, moduleId: event.target.value === "project" ? null : event.target.value }))}
        >
          <option value="project">{t("Gesamtes Projekt")}</option>
          {modules.map((module) => <option key={module.id} value={module.id}>Modul: {module.name}</option>)}
        </select>
        <div className="java-navigation-source-filter">
          <button
            className={scope.includeProduction ? "active" : ""}
            aria-pressed={scope.includeProduction}
            onClick={() => setScope((current) => ({ ...current, includeProduction: !current.includeProduction }))}
          >{t("Produktion")}</button>
          <button
            className={scope.includeTests ? "active" : ""}
            aria-pressed={scope.includeTests}
            onClick={() => setScope((current) => ({ ...current, includeTests: !current.includeTests }))}
          >{t("Tests")}</button>
        </div>
        {activeModuleId && !scope.moduleId && <button className="java-navigation-current-module" onClick={() => setScope((current) => ({ ...current, moduleId: activeModuleId }))}>{t("Aktuelles Modul")}</button>}
      </div>

      {loading && <div className="java-navigation-state"><RefreshCw size={18} className="spin" /><span>{t("JDT LS durchsucht das Projekt …")}</span></div>}
      {!loading && error && <div className="java-navigation-state error"><span>{error}</span><button onClick={onRefresh}>{t("Erneut versuchen")}</button></div>}
      {!loading && !error && !model && <div className="java-navigation-state"><Network size={24} /><span>{t("Wähle ein Java-Symbol und öffne seine Hierarchie oder Verwendungen.")}</span></div>}

      {!loading && !error && model?.kind !== "usages" && model?.root && (
        <div className="java-hierarchy-tree" role="tree" aria-label={model.title}>
          <div className="java-navigation-title"><Network size={14} /><span><strong>{model.root.name}</strong><small>{model.root.detail}</small></span></div>
          {(model.branches || []).map((branch) => {
            const visible = branch.nodes.filter((node) => matchesNavigationScope(pathFromJavaUri(node.item.uri), projectRoot, modules, scope));
            return (
              <section className="java-hierarchy-branch" key={branch.direction}>
                <header>{branch.direction === "incoming" || branch.direction === "supertypes" ? <ChevronDown size={12} /> : <ChevronRight size={12} />}<strong>{branch.label}</strong><span>{visible.length}</span></header>
                {visible.length ? visible.map((node) => renderNode(node, branch.direction, 0)) : <div className="java-navigation-empty">{branchEmpty[branch.direction]}</div>}
              </section>
            );
          })}
        </div>
      )}

      {!loading && !error && model?.kind === "usages" && (
        <div className="java-usages-tree" role="tree" aria-label={model.title}>
          <div className="java-navigation-title"><CircleDot size={13} /><span><strong>{model.title}</strong><small>{visibleUsageGroups.reduce((sum, group) => sum + group.count, 0)} Treffer</small></span></div>
          {visibleUsageGroups.map((group) => {
            const packageOpen = openPackages.has(group.packageName);
            return (
              <section className="java-usage-package" key={group.packageName}>
                <button aria-expanded={packageOpen} onClick={() => toggleSet(setOpenPackages, group.packageName)}>
                  {packageOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}<Package size={13} /><strong>{group.packageName}</strong><span>{group.count}</span>
                </button>
                {packageOpen && group.files.map((file) => {
                  const fileOpen = openFiles.has(file.path);
                  return (
                    <div className="java-usage-file" key={file.path}>
                      <button aria-expanded={fileOpen} onClick={() => toggleSet(setOpenFiles, file.path)}>
                        {fileOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}<FileCode2 size={13} /><strong>{file.name}</strong><span>{file.usages.length}</span>
                      </button>
                      {fileOpen && file.usages.map((usage) => (
                        <button className="java-usage-hit" key={usage.id} onClick={() => navigateUsage(usage)} title={usage.preview || `${usage.path}:${usage.line}`}>
                          <code>{usage.line}:{usage.column}</code><span>{usage.preview || "Verwendung"}</span>
                        </button>
                      ))}
                    </div>
                  );
                })}
              </section>
            );
          })}
          {visibleUsageGroups.length === 0 && <div className="java-navigation-empty">{t("Keine Verwendungen im gewählten Bereich")}</div>}
        </div>
      )}
    </div>
  );
}
