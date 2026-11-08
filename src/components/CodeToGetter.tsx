import { Ban, Bug, Crosshair, Check, Copy, Eye, Globe, Hammer, LogIn, LogOut, Pencil, Play, Share2, ShieldCheck, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CollabEdit, CollabPeer, CollabReachability, CollabRole, CollabTreeEntry } from "../types";
import { t } from "../i18n";
import {
  applyCollabEdit,
  collabEditsFromChanges,
  collabRootsEqual,
  createCollabSerialQueue,
  isCurrentCollabSnapshot,
} from "../collaboration/client";
import { refusalFor, SHARED_ACTIONS, type SharedAction } from "../collaboration/shared-session";
import {
  describeUnsentWork,
  stillPending,
  verdictOnReturn,
  worthKeeping,
  type ReturnVerdict,
  type UnsentWork,
} from "../collaboration/unsent-work";
import { LazyMonacoEditor } from "./LazyMonacoEditor";

/**
 * CodeToGetter — two developers on one project when only one of them has it.
 *
 * The host shares the folder it already has open. The guest holds nothing: the
 * tree, the file and every change come over the connection, and nothing is
 * written to the guest's disk at any point. That is the feature, so the guest
 * side deliberately has no path of its own to show or to save to.
 */
export function CodeToGetter({ workspaceRoot, onNotice, guestOnly = false, onHostingChange, onJoined, followedPeer = 0, onFollowPeer }: {
  workspaceRoot: string;
  onNotice: (message: string, kind: "info" | "error") => void;
  /** The Project Hub can join without pretending that the guest owns a folder. */
  guestOnly?: boolean;
  /** Lets the workbench mirror local Monaco edits while it is the host. */
  onHostingChange?: (hosting: boolean) => void;
  /**
   * Opens the shared project in the workbench once a guest is connected.
   *
   * The root that comes back is not a path on this machine, and nothing here
   * has to know that — the workbench opens it the way it opens anything else.
   */
  onJoined?: (workspaceRoot: string) => void;
  /** Whose cursor the workbench is following, and how to change that. */
  followedPeer?: number;
  onFollowPeer?: (peerId: number) => void;
}) {
  const [hosting, setHosting] = useState(false);
  const [invite, setInvite] = useState("");
  const [peers, setPeers] = useState<CollabPeer[]>([]);
  const [copied, setCopied] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [joined, setJoined] = useState("");
  const [tree, setTree] = useState<CollabTreeEntry[]>([]);
  const [openPath, setOpenPath] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  /** The host's version this editor's text is written against. */
  const version = useRef(0);
  /** Set while a remote edit is being applied, so it is not sent straight back. */
  const applyingRemote = useRef(false);
  const openPathRef = useRef("");
  /** All guest edits share one ordered wire. A reset invalidates queued work. */
  const editQueue = useRef(createCollabSerialQueue());
  /** Changes whenever the guest types, including before their IPC is sent. */
  const localRevision = useRef(0);
  const pendingEdits = useRef({
    epoch: 0,
    count: 0,
    resyncScheduled: false,
    resyncNeeded: false,
  });
  /** Invalidates a late hostState answer after Share/Stop was already clicked. */
  const hostActionEpoch = useRef(0);
  openPathRef.current = openPath;

  /** Whether the host asked for the router to let outsiders in, and how that went. */
  const [publicAccess, setPublicAccess] = useState(false);
  const [useRelay, setUseRelay] = useState(() => localStorage.getItem("kiwi.collab.relay.on") === "1");
  const [relayAddress, setRelayAddress] = useState(() => localStorage.getItem("kiwi.collab.relay") || "");
  const [reachability, setReachability] = useState<CollabReachability>({ requested: false });
  /** What guests joining from now on may do, and what this guest may do. */
  const [defaultRole, setDefaultRole] = useState<CollabRole>("lesen");
  const [myRole, setMyRole] = useState<CollabRole>("lesen");
  /**
   * What the host has actually granted.
   *
   * Not derived from the role: build and debug were never part of either role,
   * and a button offered for something the host will refuse is worse than no
   * button at all.
   */
  const [myPermissions, setMyPermissions] = useState<string[]>([]);
  /** Set by the host before sharing: guests get no copy of the project. */
  const [hostOnly, setHostOnly] = useState(false);
  /** Set on a guest that joined such a session, which changes what it can do. */
  const [joinedHostOnly, setJoinedHostOnly] = useState(false);
  /**
   * What was typed but not sent when the connection went.
   *
   * A dropped connection used to throw the buffer away with the file. Kept
   * here instead, and offered back on return rather than re-applied: putting a
   * stale buffer over a file the host has since changed loses somebody else's
   * work instead of your own.
   */
  const [unsent, setUnsent] = useState<UnsentWork | null>(null);
  const [unsentVerdict, setUnsentVerdict] = useState<ReturnVerdict | "">("");
  // Read by the disconnect handler, which is subscribed once and must not see
  // the buffer as it was when it subscribed.
  const textRef = useRef("");
  textRef.current = text;
  const hostTextRef = useRef("");
  /** What the host's toolchain has printed during this session. */
  const [sharedOutput, setSharedOutput] = useState("");
  const [sharedOutputKind, setSharedOutputKind] = useState<"build" | "debug">("build");

  const changeRole = async (peer: CollabPeer) => {
    if (!window.kiwi) return;
    const next: CollabRole = peer.role === "bearbeiten" ? "lesen" : "bearbeiten";
    try {
      await window.kiwi.collab.setPeerRole(workspaceRoot, peer.id, next);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : t("Die Berechtigung konnte nicht geändert werden."), "error");
    }
  };

  /**
   * Sends a guest away, optionally for good.
   *
   * Both go through the host: a guest is a program on another machine, and
   * nothing this side of the connection can end somebody's access to it.
   */
  const removePeer = async (peer: CollabPeer, forGood: boolean) => {
    if (!window.kiwi) return;
    try {
      if (forGood) await window.kiwi.collab.blockPeer(workspaceRoot, peer.id);
      else await window.kiwi.collab.disconnectPeer(workspaceRoot, peer.id);
      onNotice(`${peer.name} ${forGood ? t("wurde gesperrt") : t("wurde getrennt")}`, "info");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : t("Der Gast konnte nicht entfernt werden."), "error");
    }
  };
  const changeDefaultRole = async (role: CollabRole) => {
    if (!window.kiwi) return;
    setDefaultRole(role);
    try {
      await window.kiwi.collab.setDefaultRole(workspaceRoot, role);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : t("Die Berechtigung konnte nicht geändert werden."), "error");
    }
  };

  const invalidateGuestDocument = () => {
    const epoch = editQueue.current.invalidate();
    localRevision.current += 1;
    pendingEdits.current = { epoch, count: 0, resyncScheduled: false, resyncNeeded: false };
    return epoch;
  };

  const replaceWithAuthoritativeText = (nextText: string, nextVersion: number, invalidate = true) => {
    // A resync answer may cross a newer broadcast on the renderer IPC bridge.
    // Never replace a newer visible revision with that older snapshot. Explicit
    // reset/conflict messages remain authoritative and always win.
    if (!invalidate && nextVersion < version.current) return false;
    if (invalidate) invalidateGuestDocument();
    version.current = nextVersion;
    // The baseline kept work is measured against: this text came from the host
    // whole, so nothing before it is unsent any more.
    hostTextRef.current = nextText;
    applyingRemote.current = true;
    setText(nextText);
    window.setTimeout(() => { applyingRemote.current = false; }, 0);
    return true;
  };

  /**
   * A remote edit can arrive while the editor already shows optimistic local
   * edits. Showing it immediately feels responsive, then this queued read
   * verifies the exact host text after the outstanding writes have settled.
   */
  const resyncAfterPendingEdit = (path: string, epoch: number) => {
    const pending = pendingEdits.current;
    if (!window.kiwi || pending.epoch !== epoch) return;
    pending.resyncNeeded = true;
    if (pending.resyncScheduled) return;
    pending.resyncScheduled = true;
    const requested = { epoch, path, localRevision: localRevision.current };
    const resync = editQueue.current.enqueue(epoch, async () => {
      const current = {
        epoch: editQueue.current.current(),
        path: openPathRef.current,
        localRevision: localRevision.current,
      };
      if (!isCurrentCollabSnapshot(requested, current)) return;
      const opened = await window.kiwi!.collab.request("open", { path });
      const afterRequest = {
        epoch: editQueue.current.current(),
        path: openPathRef.current,
        localRevision: localRevision.current,
      };
      // Typing while `open` was in flight wins. Its optimistic text stays on
      // screen and a fresh resync will be queued behind that edit instead.
      if (!isCurrentCollabSnapshot(requested, afterRequest)) return;
      replaceWithAuthoritativeText(opened.text, opened.version, false);
      if (pendingEdits.current.epoch === epoch) pendingEdits.current.resyncNeeded = false;
    });
    void resync.catch((error) => {
      if (editQueue.current.isCurrent(epoch)) {
        pendingEdits.current.resyncNeeded = false;
        onNotice(error instanceof Error ? error.message : t("Die Datei konnte nicht abgeglichen werden."), "error");
      }
    }).finally(() => {
      if (pendingEdits.current.epoch !== epoch) return;
      pendingEdits.current.resyncScheduled = false;
      if (pendingEdits.current.resyncNeeded && openPathRef.current === path) {
        // If a newer edit made the snapshot stale, this call lands behind that
        // edit in the same serial queue and retries only after typing is quiet.
        resyncAfterPendingEdit(path, epoch);
      }
    });
  };

  useEffect(() => () => {
    // Closing either the Hub dialog or the right tool must drop a guest
    // connection. A hidden socket with no editor cannot safely keep receiving
    // edits and used to reappear in an unrelated project later.
    invalidateGuestDocument();
    void window.kiwi?.collab.leave().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!window.kiwi) return undefined;
    let disposed = false;
    const stateEpoch = hostActionEpoch.current;
    void window.kiwi.collab.hostState().then((state) => {
      if (disposed || stateEpoch !== hostActionEpoch.current) return;
      const ownsSession = !guestOnly
        && state.hosting
        && collabRootsEqual(state.root || "", workspaceRoot);
      setHosting(ownsSession);
      setInvite(ownsSession ? state.invite || "" : "");
      setPeers(ownsSession ? state.peers || [] : []);
      setDefaultRole(ownsSession ? state.defaultRole || "lesen" : "lesen");
      onHostingChange?.(ownsSession);
    }).catch(() => undefined);
    // What the host's build, tests and debugger printed. The guest has no
    // toolchain of its own, so without this the two of them were editing the
    // same file and only one of them ever knew whether it compiled.
    const stopOutput = window.kiwi.collab.onOutput(({ channel, payload }) => {
      const text = String((payload as { text?: string })?.text ?? "");
      if (!text) return;
      setSharedOutput((lines) => {
        const next = `${lines}${text}`;
        // A long build would otherwise grow without limit in a panel nobody
        // can clear from this side.
        return next.length > 200_000 ? next.slice(-200_000) : next;
      });
      setSharedOutputKind(channel.startsWith("debug") ? "debug" : "build");
    });
    // The project as it is now, not as it was when the guest joined. A file
    // somebody adds while a session runs used to be invisible until a rejoin.
    const stopTree = window.kiwi.collab.onTreeChanged(() => {
      void window.kiwi?.collab.request("tree")
        .then((listing: any) => setTree(listing.entries.filter((entry: CollabTreeEntry) => !entry.directory)))
        .catch(() => undefined);
    });
    const stopPeers = window.kiwi.collab.onPeers((payload) => {
      if (payload.session !== "host") return;
      setPeers(payload.peers || []);
      if (payload.joined) onNotice(`${payload.joined} ${t("ist der Sitzung beigetreten")}`, "info");
      if (payload.left) onNotice(`${payload.left} ${t("hat die Sitzung verlassen")}`, "info");
    });
    const stopRemoved = window.kiwi.collab.onRemoved((payload) => {
      if (payload.session !== "guest") return;
      // The host said why. Showing it is the difference between being asked
      // to leave and believing the network broke — and somebody who believes
      // that reconnects immediately.
      onNotice(payload.message || t("Der Gastgeber hat die Sitzung für dich beendet."), "error");
    });
    const stopRole = window.kiwi.collab.onRole((payload) => {
      if (payload.session !== "guest") return;
      setMyRole(payload.role);
      setMyPermissions(payload.permissions || []);
      // Said plainly, because an editor that quietly stops accepting what is
      // typed into it is worse than one that says it is read-only now.
      onNotice(payload.role === "bearbeiten"
        ? t("Du darfst jetzt bearbeiten.")
        : t("Du darfst jetzt nur noch lesen."), "info");
    });
    const stopReset = window.kiwi.collab.onReset((payload) => {
      if (payload.session !== "guest") return;
      if (payload.path !== openPathRef.current) return;
      replaceWithAuthoritativeText(payload.text, payload.version);
      onNotice(t("Die Datei wurde mit dem aktuellen Stand des Gastgebers abgeglichen."), "info");
    });
    const stopEdit = window.kiwi.collab.onEdit((payload) => {
      if (payload.session !== "guest") return;
      if (payload.path !== openPathRef.current) return;
      const epoch = editQueue.current.current();
      const hasPendingLocalEdits = pendingEdits.current.epoch === epoch && pendingEdits.current.count > 0;
      applyingRemote.current = true;
      version.current = Math.max(version.current, payload.version);
      setText((current) => applyCollabEdit(current, payload.edit));
      window.setTimeout(() => { applyingRemote.current = false; }, 0);
      if (hasPendingLocalEdits) resyncAfterPendingEdit(payload.path, epoch);
    });
    const stopSaved = window.kiwi.collab.onSaved((payload) => {
      if (payload.session !== "guest") return;
      if (payload.path === openPathRef.current && payload.by) {
        const currentVersion = payload.currentVersion ?? payload.version;
        if (currentVersion !== undefined) version.current = Math.max(version.current, currentVersion);
        const snapshotIsCurrent = payload.dirty !== true
          && (payload.currentVersion === undefined || payload.version === undefined
            || payload.currentVersion === payload.version);
        onNotice(
          `${payload.path} ${t("wurde beim Gastgeber gespeichert")} · ${payload.by}${snapshotIsCurrent ? "" : ` · ${t("Änderungen noch nicht angewendet")}`}`,
          "info",
        );
      }
    });
    const stopGone = window.kiwi.collab.onDisconnected((payload) => {
      if (payload.session !== "guest") return;
      // Before anything is cleared, because clearing is what lost it.
      const keep = worthKeeping(openPathRef.current, textRef.current, hostTextRef.current);
      if (keep) {
        setUnsent({
          path: openPathRef.current,
          text: textRef.current,
          version: version.current,
          at: Date.now(),
        });
      }
      invalidateGuestDocument();
      setJoined("");
      setTree([]);
      setOpenPath("");
      onNotice(keep
        ? t("Die Verbindung wurde beendet. Deine ungesendeten Änderungen sind gesichert.")
        : t("Die Verbindung zum Gastgeber wurde beendet."), "error");
    });
    return () => {
      disposed = true;
      stopOutput();
      stopTree();
      stopPeers();
      stopRole();
      stopRemoved();
      stopReset();
      stopEdit();
      stopSaved();
      stopGone();
    };
  }, [guestOnly, onHostingChange, onNotice, workspaceRoot]);

  const share = async () => {
    if (!window.kiwi || !workspaceRoot) return;
    const actionEpoch = hostActionEpoch.current + 1;
    hostActionEpoch.current = actionEpoch;
    setBusy(true);
    try {
      // Remembered before the attempt: a relay that refused is still the
      // address the next attempt should start from.
      localStorage.setItem("kiwi.collab.relay.on", useRelay ? "1" : "0");
      localStorage.setItem("kiwi.collab.relay", relayAddress.trim());
      const session = await window.kiwi.collab.host(
        workspaceRoot,
        useRelay ? false : publicAccess,
        useRelay ? relayAddress.trim() : "",
        hostOnly,
      );
      if (actionEpoch !== hostActionEpoch.current) return;
      setInvite(session.invite);
      setHosting(true);
      onHostingChange?.(true);
      setReachability(session.publicAccess || { requested: false });
      // A router that refused is not a dead end: the numbers it refused with
      // are exactly what its own configuration page asks for, and saying them
      // is the difference between a failure and a next step.
      if (publicAccess && !session.publicAccess?.opened) {
        onNotice(`${t("Der Router hat die Freigabe nicht übernommen.")} ${session.publicAccess?.reason || ""}`.trim(), "error");
      }
    } catch (error) {
      onNotice(error instanceof Error ? error.message : t("Die Sitzung konnte nicht gestartet werden."), "error");
    } finally {
      setBusy(false);
    }
  };

  const stopSharing = async () => {
    hostActionEpoch.current += 1;
    await window.kiwi?.collab.stopHosting().catch(() => undefined);
    setHosting(false);
    setInvite("");
    setPeers([]);
    setReachability({ requested: false });
    onHostingChange?.(false);
  };

  const copyInvite = async () => {
    await navigator.clipboard.writeText(invite).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const join = async () => {
    if (!window.kiwi || !code.trim()) return;
    invalidateGuestDocument();
    setBusy(true);
    try {
      const welcome = await window.kiwi.collab.join(code.trim(), name.trim() || t("Gast"));
      setJoined(welcome.project);
      setMyRole(welcome.role || "lesen");
      setMyPermissions(welcome.permissions || []);
      setJoinedHostOnly(Boolean(welcome.hostOnly));
      if (welcome.workspaceRoot) onJoined?.(welcome.workspaceRoot);
      const listing = await window.kiwi.collab.request("tree");
      setTree(listing.entries.filter((entry) => !entry.directory));
    } catch (error) {
      onNotice(error instanceof Error ? error.message : t("Der Beitritt ist fehlgeschlagen."), "error");
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    invalidateGuestDocument();
    await window.kiwi?.collab.leave().catch(() => undefined);
    setJoined("");
    setTree([]);
    setOpenPath("");
    setText("");
  };

  /**
   * Asks the host's machine to build, test, run or debug.
   *
   * The output already comes back the same way the host sees it, so nothing
   * here waits for a result: what happens next appears in the shared output
   * below, which is where a build's answer belongs.
   */
  const startShared = async (action: SharedAction) => {
    if (!window.kiwi) return;
    try {
      await window.kiwi.collab.request("run", { action });
    } catch (error) {
      onNotice(error instanceof Error ? error.message : refusalFor(action), "error");
    }
  };

  /**
   * Puts kept work back into the buffer.
   *
   * Only into the buffer: sending it on is the ordinary save, with the
   * ordinary permission check, so restoring never writes to the host's disk by
   * itself.
   */
  const restoreUnsent = () => {
    if (!unsent) return;
    setText(unsent.text);
    setUnsentVerdict("");
    setUnsent(null);
    onNotice(t("Deine Änderungen sind wieder da. Sie sind noch nicht beim Gastgeber."), "info");
  };

  const openShared = async (entry: CollabTreeEntry) => {
    if (!window.kiwi) return;
    const epoch = invalidateGuestDocument();
    // Stop accepting keystrokes for the old document while its last request
    // drains. This also makes a rapid double click on two files deterministic.
    openPathRef.current = "";
    setOpenPath("");
    try {
      // Let an already transmitted edit settle before switching documents.
      await editQueue.current.idle();
      if (!editQueue.current.isCurrent(epoch)) return;
      const opened = await window.kiwi.collab.request("open", { path: entry.path });
      if (!editQueue.current.isCurrent(epoch)) return;
      applyingRemote.current = true;
      version.current = opened.version;
      hostTextRef.current = opened.text;
      setOpenPath(opened.path);
      setText(opened.text);
      // Kept work is offered here and nowhere else: this is the moment the
      // host's own text is in hand to compare against.
      setUnsentVerdict(unsent?.path === opened.path
        ? verdictOnReturn(unsent, { text: opened.text, version: opened.version })
        : "");
      if (unsent && !stillPending(unsent, opened.text, opened.path)) setUnsent(null);
      window.setTimeout(() => { applyingRemote.current = false; }, 0);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : t("Die Datei konnte nicht geöffnet werden."), "error");
    }
  };

  /**
   * Sends one change to the host and takes its answer as the truth.
   *
   * The host is the authority: it may move the edit over somebody else's, and
   * when the two genuinely collide it sends the whole text back instead. An
   * editor that argues with that ends up showing a file nobody has.
   */
  const sendEdits = (edits: CollabEdit[]) => {
    if (!window.kiwi || !openPathRef.current || !edits.length) return;
    const path = openPathRef.current;
    const epoch = editQueue.current.current();
    if (pendingEdits.current.epoch !== epoch) {
      pendingEdits.current = { epoch, count: 0, resyncScheduled: false, resyncNeeded: false };
    }
    pendingEdits.current.count += edits.length;
    const request = editQueue.current.enqueue(epoch, async () => {
      for (const edit of edits) {
        if (!editQueue.current.isCurrent(epoch) || path !== openPathRef.current) return;
        const result = await window.kiwi!.collab.request("edit", {
          path,
          edit,
          baseVersion: version.current,
        });
        // A reset/open/leave may have happened while the IPC request was in
        // flight. Its answer belongs to the old document epoch in that case.
        if (!editQueue.current.isCurrent(epoch) || path !== openPathRef.current) return;
        if (result.applied) {
          version.current = Math.max(version.current, result.version);
          continue;
        }
        replaceWithAuthoritativeText(result.text || "", result.version);
        onNotice(t("Die Datei wurde neu geladen, weil beide dieselbe Stelle geändert haben."), "info");
        return;
      }
    });
    void request.catch((error) => {
      if (editQueue.current.isCurrent(epoch)) {
        onNotice(error instanceof Error ? error.message : t("Die Änderung kam nicht an."), "error");
      }
    }).finally(() => {
      if (pendingEdits.current.epoch === epoch) {
        pendingEdits.current.count = Math.max(0, pendingEdits.current.count - edits.length);
      }
    });
  };

  const saveShared = async () => {
    if (!window.kiwi || !openPath) return;
    const path = openPath;
    const epoch = editQueue.current.current();
    try {
      // The save itself is part of the edit queue. New typing is appended after
      // it, so the answer describes exactly the snapshot that reached disk.
      const result = await editQueue.current.enqueue(epoch, () =>
        window.kiwi!.collab.request("save", { path }));
      if (!result) return;
      if (!editQueue.current.isCurrent(epoch) || openPathRef.current !== path) return;
      if (!result.saved) {
        replaceWithAuthoritativeText(result.text || "", result.version);
        onNotice(t("Die Datei wurde nicht gespeichert, weil sie sich beim Gastgeber geändert hat. Der aktuelle Stand wurde neu geladen."), "error");
        return;
      }
      const currentVersion = result.currentVersion ?? result.version;
      version.current = Math.max(version.current, currentVersion);
      const snapshotIsCurrent = result.dirty !== true && currentVersion === result.version;
      // What reached the host's disk is no longer unsent.
      if (snapshotIsCurrent) hostTextRef.current = textRef.current;
      onNotice(
        `${path} ${t("wurde beim Gastgeber gespeichert")}${snapshotIsCurrent ? "" : ` · ${t("Änderungen noch nicht angewendet")}`}`,
        "info",
      );
    } catch (error) {
      onNotice(error instanceof Error ? error.message : t("Das Speichern ist fehlgeschlagen."), "error");
    }
  };

  return (
    <div className={`codetogetter ${guestOnly ? "guest-only" : ""}`}>
      {!guestOnly && <section className="codetogetter-side">
        <header><Share2 size={14} /><strong>{t("Gastgeber")}</strong></header>
        {!workspaceRoot && <small>{t("Zum Teilen muss ein Projekt geöffnet sein.")}</small>}
        {workspaceRoot && !hosting && (
          <>
            {/* Opening a port on somebody's router is a decision, so it is one
                the host makes rather than something that happens to them. A
                relay is the other way round: both sides dial out, which routers
                allow without being asked, so nothing has to be configured. */}
            <label className="codetogetter-public">
              <input
                type="checkbox"
                checked={useRelay}
                onChange={(event) => setUseRelay(event.target.checked)}
              />
              <Globe size={12} />
              {t("Über ein Relay verbinden (keine Portfreigabe nötig)")}
            </label>
            {useRelay ? (
              <input
                value={relayAddress}
                onChange={(event) => setRelayAddress(event.target.value)}
                placeholder={t("Relay-Adresse, z. B. relay.example.org:8787")}
                aria-label={t("Relay-Adresse, z. B. relay.example.org:8787")}
              />
            ) : (
              <label className="codetogetter-public">
                <input
                  type="checkbox"
                  checked={publicAccess}
                  onChange={(event) => setPublicAccess(event.target.checked)}
                />
                {t("Auch außerhalb des Heimnetzes erreichbar")}
              </label>
            )}
            {/* The trade is real and belongs here, not in a changelog: a guest
                normally gets a working copy in a temporary folder, because that
                is what makes the language server, the build and the debugger
                work for them. For a codebase that may not leave this machine it
                goes the other way. */}
            <label className="codetogetter-public">
              <input
                type="checkbox"
                checked={hostOnly}
                onChange={(event) => setHostOnly(event.target.checked)}
              />
              <ShieldCheck size={12} />
              {t("Keine Kopie beim Gast (kein Language Server und kein Build für Gäste)")}
            </label>
            <button
              className="settings-sdk-add"
              onClick={() => void share()}
              disabled={busy || (useRelay && !relayAddress.trim())}
            >
              <Share2 size={13} /> {t("Projekt teilen")}
            </button>
          </>
        )}
        {hosting && (
          <>
            <label>{t("Einladungscode")}</label>
            <div className="codetogetter-invite">
              <input readOnly value={invite} aria-label={t("Einladungscode")} />
              <button onClick={() => void copyInvite()} title={t("Einladungscode kopieren")}>
                {copied ? <Check size={13} /> : <Copy size={13} />}
              </button>
            </div>
            {/* Worth saying plainly: the code is the key, and anyone holding it
                can read and change the shared project. */}
            <small>{t("Wer diesen Code hat, darf das Projekt lesen und ändern. Nur an Personen weitergeben, denen du das erlaubst.")}</small>
            <small className="codetogetter-security">{t("Die Verbindung ist mit dem Einladungsschlüssel Ende-zu-Ende verschlüsselt.")}</small>
            {reachability.requested && (
              <small className={reachability.opened ? "codetogetter-reach" : "codetogetter-reach failed"}>
                {reachability.opened
                  ? `${t("Der Router leitet weiter")} (${reachability.protocol})`
                  : (
                    <>
                      {t("Der Router hat die Freigabe nicht übernommen. Von Hand einzurichten:")}
                      {" "}
                      <code>{`${t("Port")} ${reachability.port} → ${reachability.localAddress || "?"}`}</code>
                      {reachability.gateway ? <> · <code>{reachability.gateway}</code></> : null}
                    </>
                  )}
              </small>
            )}
            <div className="codetogetter-peers">
              <Users size={13} />
              {peers.length
                ? peers.map((peer) => {
                  // Kept out of the title expression on purpose: the role is a
                  // value, and a German value sitting in a prop the translation
                  // guard reads would be mistaken for a label needing a word in
                  // eleven languages.
                  const editing = peer.role === "bearbeiten";
                  // The badge knows two words and there are six permissions.
                  // A guest who may start a build on this machine reading as
                  // "liest nur" is not a small imprecision: it is the host's
                  // only view of what they handed out.
                  const extra = (peer.permissions || [])
                    .filter((permission) => permission !== "bearbeiten" && permission !== "speichern");
                  return (
                    <span key={peer.id} className="codetogetter-peer">
                      {peer.name}
                      {extra.length > 0 && <em className="codetogetter-grants">{extra.join(", ")}</em>}
                      {/* The switch is the grant itself, so it says what it will
                          do rather than what is currently true. */}
                      <button
                        className={editing ? "granted" : ""}
                        title={editing ? t("Auf Nur-Lesen zurücksetzen") : t("Bearbeiten erlauben")}
                        onClick={() => void changeRole(peer)}
                      >
                        {editing ? <Pencil size={11} /> : <Eye size={11} />}
                        {editing ? t("darf bearbeiten") : t("liest nur")}
                      </button>
                      {/* Following somebody means the editor goes where they
                          go: their file is opened and their place scrolled to,
                          which is what makes watching each other work. */}
                      <button
                        className={followedPeer === peer.id ? "granted" : ""}
                        title={followedPeer === peer.id ? t("Nicht mehr folgen") : t("Diesem Nutzer folgen")}
                        onClick={() => onFollowPeer?.(followedPeer === peer.id ? 0 : peer.id)}
                      >
                        <Crosshair size={11} />
                        {followedPeer === peer.id ? t("folgt") : t("folgen")}
                      </button>
                      <button title={t("Diesen Gast trennen")} onClick={() => void removePeer(peer, false)}>
                        <LogOut size={11} />
                      </button>
                      {/* Blocking is the stronger of the two and is held against
                          the address, so it survives a reconnect under a new name. */}
                      <button title={t("Diesen Gast sperren")} onClick={() => void removePeer(peer, true)}>
                        <Ban size={11} />
                      </button>
                    </span>
                  );
                })
                : <small>{t("Niemand verbunden")}</small>}
            </div>
            <label className="codetogetter-default-role">
              {t("Neue Gäste dürfen")}
              <select
                value={defaultRole}
                onChange={(event) => void changeDefaultRole(event.target.value as CollabRole)}
              >
                <option value="lesen">{t("nur lesen")}</option>
                <option value="bearbeiten">{t("lesen und bearbeiten")}</option>
              </select>
            </label>
            <button className="settings-sdk-add" onClick={() => void stopSharing()}>
              <LogOut size={13} /> {t("Teilen beenden")}
            </button>
          </>
        )}
      </section>}

      <section className="codetogetter-side">
        <header><LogIn size={14} /><strong>{t("Gast")}</strong></header>
        {/* Was "nicht verschlüsselt", which the channel has not been for some
            time: collab-secure-channel encrypts every frame with AES-256-GCM,
            and GCM is authenticated, so a frame that was tampered with fails to
            open rather than decoding into something else. What still deserves
            saying is who is let in — the code is the whole admission. */}
        {!joined && <small className="codetogetter-security">Die Verbindung ist mit AES-256-GCM verschlüsselt und gegen Veränderung geschützt. Gib den Sitzungscode nur an Personen weiter, denen du Zugriff auf dein Projekt geben möchtest.</small>}
        {!joined && (
          <>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder={t("Einladungscode einfügen")}
              aria-label={t("Einladungscode einfügen")}
            />
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("Dein Name")}
              aria-label={t("Dein Name")}
            />
            <button className="settings-sdk-add" onClick={() => void join()} disabled={busy || !code.trim()}>
              <LogIn size={13} /> {t("Beitreten")}
            </button>
          </>
        )}
        {joined && (
          <>
            <small>{t("Verbunden mit")} <strong>{joined}</strong></small>
            <small className="codetogetter-role">
              {myRole === "bearbeiten"
                ? <><Pencil size={11} /> {t("Du darfst lesen und bearbeiten.")}</>
                : <><Eye size={11} /> {t("Du darfst nur lesen.")}</>}
            </small>
            <small className="codetogetter-copy">
              {/* Said where it happens, not in a changelog: files land on this
                  machine for the length of the session, and that is the one
                  thing a guest would not expect and would mind. */}
              {joinedHostOnly
                ? t("Der Gastgeber erlaubt keine Kopie: nichts vom Projekt wird auf diesem Rechner gespeichert. Dafür gibt es hier keinen Language Server und keinen Build.")
                : t("Das Projekt wird als temporäre Arbeitskopie geöffnet und beim Verlassen wieder gelöscht.")}
            </small>
            {(myPermissions.includes("build") || myPermissions.includes("debug")) && (
              <div className="codetogetter-actions">
                {/* Only what the host granted. The refusal still happens on the
                    host — this decides what is worth offering, not what is
                    allowed. */}
                {myPermissions.includes("build") && SHARED_ACTIONS
                  .filter((action) => action !== "debug")
                  .map((action) => (
                    <button key={action} onClick={() => void startShared(action)} disabled={busy}>
                      {action === "build" ? <Hammer size={12} /> : <Play size={12} />}
                      {action === "build" ? t("Bauen") : action === "test" ? t("Tests") : t("Ausführen")}
                    </button>
                  ))}
                {myPermissions.includes("debug") && (
                  <button onClick={() => void startShared("debug")} disabled={busy}>
                    <Bug size={12} /> {t("Debuggen")}
                  </button>
                )}
              </div>
            )}
            <div className="codetogetter-tree">
              {tree.map((entry) => (
                <button
                  key={entry.path}
                  className={entry.path === openPath ? "active" : ""}
                  onClick={() => void openShared(entry)}
                >{entry.path}</button>
              ))}
            </div>
            <button className="settings-sdk-add" onClick={() => void leave()}>
              <LogOut size={13} /> {t("Sitzung verlassen")}
            </button>
          </>
        )}
      </section>

      {joined && sharedOutput && (
        <section className="codetogetter-output">
          <header>
            <strong>{sharedOutputKind === "debug" ? t("Debug beim Gastgeber") : t("Build und Tests beim Gastgeber")}</strong>
            <button onClick={() => setSharedOutput("")}>{t("Leeren")}</button>
          </header>
          {/* Only the host has a toolchain, so this is the guest's only way of
              seeing whether what they are both editing compiles. */}
          <pre ref={(node) => { if (node) node.scrollTop = node.scrollHeight; }}>{sharedOutput}</pre>
        </section>
      )}

      {joined && openPath && (
        <section className="codetogetter-editor">
          <header>
            <strong>{openPath}</strong>
            <button onClick={() => void saveShared()} disabled={myRole !== "bearbeiten"}>{t("Beim Gastgeber speichern")}</button>
          </header>
          {unsentVerdict && unsentVerdict !== "arrived" && (
            /* Offered, never applied. A stale buffer put back over a file the
               host has since changed loses somebody else's work instead of
               your own, so a person decides and is told which case this is. */
            <div className={`codetogetter-unsent ${unsentVerdict}`}>
              <span>{describeUnsentWork(unsent, unsentVerdict)}</span>
              <button onClick={() => restoreUnsent()}>{t("Wiederherstellen")}</button>
              <button onClick={() => { setUnsent(null); setUnsentVerdict(""); }}>{t("Verwerfen")}</button>
            </div>
          )}
          <LazyMonacoEditor
            value={text}
            language={openPath.endsWith(".java") ? "java" : "plaintext"}
            options={{ readOnly: myRole !== "bearbeiten" }}
            onChange={(value, event) => {
              setText(value ?? "");
              if (applyingRemote.current) return;
              // Monaco reports exact spans instead of forcing a text diff. All
              // offsets refer to the pre-change text; end-to-start application
              // keeps earlier offsets valid regardless of array order.
              const edits = collabEditsFromChanges([...(event?.changes || [])]);
              if (edits.length) localRevision.current += 1;
              sendEdits(edits);
            }}
          />
        </section>
      )}
    </div>
  );
}
