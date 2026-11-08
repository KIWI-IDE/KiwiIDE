/**
 * Everything Kiwi knows about the repository the open project is in.
 *
 * The status, the branches, the history, the diff being read, the hunks picked
 * out of it, the stashes, the merge in progress and who is signed in to GitHub
 * — together with the operations that move them. It was spread through a
 * fourteen-thousand-line component, where the only thing holding it together
 * was that the names started with "git".
 *
 * Everything is handed back under the name it already had, so the workbench
 * reads exactly as it did: `gitStatus`, `refreshGit`, `performGitAction`. What
 * changed is where they are written, not how they are used.
 */
import { useCallback, useState } from "react";
import type { GitComparison, GitHubSession, GitStatus } from "../types";
import type { DiffCoverage } from "../coverage-detail";
import type { WorkbenchDocument } from "./workbench-types";

/** What the operations need from the workbench around them. */
export interface GitWorkbenchDeps {
  workspaceRoot: string;
  toast: (message: string, kind?: "success" | "error" | "info") => void;
  setActiveDocument: (document: WorkbenchDocument | null) => void;
  /** Creating a branch asks for its name in the middle of the window. */
  askForName: (request: {
    title: string;
    description?: string;
    label: string;
    initialValue?: string;
    placeholder?: string;
    confirmLabel?: string;
    variant?: "dialog" | "quick";
    validate?: (value: string) => string | null;
    action: (value: string) => void | Promise<void>;
  } | null) => void;
}

export function useGitWorkbench({ workspaceRoot, toast, setActiveDocument, askForName }: GitWorkbenchDeps) {
  const [gitStatus, setGitStatus] = useState<GitStatus>({ available: false, output: "" });

  /**
   * Coverage of the change rather than of the project.
   *
   * A project-wide percentage answers a question nobody asked. The one worth
   * answering is narrower: of the lines this change touches, how many are
   * covered — which is the number that decides whether the change is tested.
   */
  const [diffCoverageResult, setDiffCoverageResult] = useState<DiffCoverage | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [gitHistory, setGitHistory] = useState<Array<{ shortHash: string; subject: string; author: string; date: string }>>([]);
  const [gitBranches, setGitBranches] = useState<Array<{ current: boolean; name: string; upstream: string }>>([]);
  const [gitDiff, setGitDiff] = useState("");
  const [gitDiffMode, setGitDiffMode] = useState<"inline" | "split">("split");
  const [gitComparison, setGitComparison] = useState<GitComparison | null>(null);
  const [gitDiffSelection, setGitDiffSelection] = useState<{
    file: string;
    staged: boolean;
    hunks: Array<{
      index: number;
      header: string;
      preview: string;
      changes: Array<{ id: string; kind: "add" | "remove" | "replace"; before: string; after: string; indexes: number[] }>;
    }>;
  } | null>(null);
  const [gitLineSelection, setGitLineSelection] = useState<Record<string, string[]>>({});
  const [gitMenuOpen, setGitMenuOpen] = useState(false);
  const [gitStashes, setGitStashes] = useState<Array<{ ref: string; hash: string; date: string; message: string }>>([]);
  const [mergeEditor, setMergeEditor] = useState<{ path: string; base: string; ours: string; theirs: string; result: string } | null>(null);

  const [githubSession, setGithubSession] = useState<GitHubSession | null>(null);
  const [githubSignInOpen, setGithubSignInOpen] = useState(false);

  const refreshGit = useCallback(async (root = workspaceRoot) => {
    if (!root || !window.kiwi) return;
    const [status, stashes] = await Promise.all([
      window.kiwi.git.status(root),
      window.kiwi.git.stashes(root).catch(() => []),
    ]);
    setGitStatus(status);
    setGitStashes(stashes);
  }, [workspaceRoot]);

  const openPullPreview = useCallback(async () => {
    if (!workspaceRoot || !window.kiwi) return;
    try {
      const comparison = await window.kiwi.git.previewPull(workspaceRoot);
      setGitComparison(comparison);
      setActiveDocument("git-compare");
      setGitMenuOpen(false);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Eingehende Änderungen konnten nicht geprüft werden.", "error");
    }
  }, [toast, workspaceRoot]);

  const signOutOfGitHub = useCallback(async () => {
    if (!window.kiwi) return;
    setGithubSession(await window.kiwi.git.githubSignOut());
    toast("Von GitHub abgemeldet", "success");
  }, [toast]);

  const performGitAction = useCallback(async (action: "stageAll" | "unstageAll" | "commit" | "commitAll" | "commitAndPush" | "amend" | "pull" | "push" | "init") => {
    if (!workspaceRoot || !window.kiwi) return;
    try {
      if (action === "init") setGitStatus(await window.kiwi.git.init(workspaceRoot));
      if (action === "stageAll") setGitStatus(await window.kiwi.git.stage(workspaceRoot, (gitStatus.files || []).filter((file) => !file.staged).map((file) => file.absolutePath)));
      if (action === "unstageAll") setGitStatus(await window.kiwi.git.unstage(workspaceRoot, (gitStatus.files || []).filter((file) => file.staged).map((file) => file.absolutePath)));
      if (action === "commit" || action === "commitAll" || action === "commitAndPush" || action === "amend") {
        const result = await window.kiwi.git.commit(workspaceRoot, commitMessage, {
          // "Alles committen" and "Commit & Push" stage first, so the loop is
          // one action instead of four for what is a single thought.
          stageAll: action === "commitAll" || action === "commitAndPush",
          amend: action === "amend",
        });
        setGitStatus(result.status);
        setCommitMessage("");
        if (action === "commitAndPush") {
          const pushed = await window.kiwi.git.push(workspaceRoot, !(gitStatus.branchLine || "").includes("..."));
          setGitStatus(pushed.status);
        }
        setGitHistory(await window.kiwi.git.log(workspaceRoot, 30));
        toast(action === "amend"
          ? "Commit ergänzt"
          : action === "commitAndPush" ? "Commit erstellt und gepusht" : "Commit erstellt", "success");
      }
      if (action === "pull") {
        const result = await window.kiwi.git.pull(workspaceRoot);
        setGitStatus(result.status);
        toast("Pull abgeschlossen", "success");
      }
      if (action === "push") {
        const result = await window.kiwi.git.push(workspaceRoot, !(gitStatus.branchLine || "").includes("..."));
        setGitStatus(result.status);
        toast("Push abgeschlossen", "success");
      }
      setGitBranches(await window.kiwi.git.branches(workspaceRoot).catch(() => []));
    } catch (error) {
      toast(error instanceof Error ? error.message : "Git-Aktion fehlgeschlagen.", "error");
    }
  }, [commitMessage, gitStatus, toast, workspaceRoot]);

  const createGitBranch = useCallback(() => {
    if (!workspaceRoot || !window.kiwi) return;
    askForName({
      title: "Git-Branch erstellen",
      label: "Branch-Name",
      initialValue: "feature/",
      confirmLabel: "Erstellen und wechseln",
      validate: (name) => /^[A-Za-z0-9._/-]+$/.test(name) && !name.includes("..") ? null : "Ungültiger Branch-Name.",
      action: async (name) => {
        try {
          setGitBranches(await window.kiwi!.git.createBranch(workspaceRoot, name, true));
          setGitStatus(await window.kiwi!.git.status(workspaceRoot));
          askForName(null);
          toast(`Branch ${name} erstellt`, "success");
        } catch (error) {
          toast(error instanceof Error ? error.message : "Branch konnte nicht erstellt werden.", "error");
        }
      },
    });
  }, [toast, workspaceRoot]);

  return {
    gitStatus,
    setGitStatus,
    diffCoverageResult,
    setDiffCoverageResult,
    commitMessage,
    setCommitMessage,
    gitHistory,
    setGitHistory,
    gitBranches,
    setGitBranches,
    gitDiff,
    setGitDiff,
    gitDiffMode,
    setGitDiffMode,
    gitComparison,
    setGitComparison,
    gitDiffSelection,
    setGitDiffSelection,
    gitLineSelection,
    setGitLineSelection,
    gitMenuOpen,
    setGitMenuOpen,
    gitStashes,
    setGitStashes,
    mergeEditor,
    setMergeEditor,
    githubSession,
    setGithubSession,
    githubSignInOpen,
    setGithubSignInOpen,
    refreshGit,
    openPullPreview,
    performGitAction,
    createGitBranch,
    signOutOfGitHub,
  } as const;
}
