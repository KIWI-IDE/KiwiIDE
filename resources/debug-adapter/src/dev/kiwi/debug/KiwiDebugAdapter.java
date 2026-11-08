package dev.kiwi.debug;

import com.sun.jdi.ArrayReference;
import com.sun.jdi.BooleanValue;
import com.sun.jdi.Bootstrap;
import com.sun.jdi.ClassType;
import com.sun.jdi.Field;
import com.sun.jdi.IncompatibleThreadStateException;
import com.sun.jdi.LocalVariable;
import com.sun.jdi.Location;
import com.sun.jdi.Method;
import com.sun.jdi.NativeMethodException;
import com.sun.jdi.ObjectReference;
import com.sun.jdi.ReferenceType;
import com.sun.jdi.StackFrame;
import com.sun.jdi.StringReference;
import com.sun.jdi.ThreadReference;
import com.sun.jdi.Value;
import com.sun.jdi.VirtualMachine;
import com.sun.jdi.VirtualMachineManager;
import com.sun.jdi.connect.AttachingConnector;
import com.sun.jdi.connect.Connector;
import com.sun.jdi.event.AccessWatchpointEvent;
import com.sun.jdi.event.BreakpointEvent;
import com.sun.jdi.event.ClassPrepareEvent;
import com.sun.jdi.event.Event;
import com.sun.jdi.event.EventSet;
import com.sun.jdi.event.ExceptionEvent;
import com.sun.jdi.event.MethodEntryEvent;
import com.sun.jdi.event.MethodExitEvent;
import com.sun.jdi.event.ModificationWatchpointEvent;
import com.sun.jdi.event.StepEvent;
import com.sun.jdi.event.VMDeathEvent;
import com.sun.jdi.event.VMDisconnectEvent;
import com.sun.jdi.event.VMStartEvent;
import com.sun.jdi.event.WatchpointEvent;
import com.sun.jdi.request.AccessWatchpointRequest;
import com.sun.jdi.request.BreakpointRequest;
import com.sun.jdi.request.ClassPrepareRequest;
import com.sun.jdi.request.EventRequest;
import com.sun.jdi.request.EventRequestManager;
import com.sun.jdi.request.ExceptionRequest;
import com.sun.jdi.request.MethodEntryRequest;
import com.sun.jdi.request.MethodExitRequest;
import com.sun.jdi.request.ModificationWatchpointRequest;
import com.sun.jdi.request.StepRequest;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Minimal, dependency-free JDI adapter for Kiwi IDE.
 *
 * The Electron process and this adapter communicate through a small tab-separated
 * protocol. User-controlled strings are Base64 encoded so paths, expressions and
 * values cannot break framing. JDI owns JDWP communication; JDB is not involved.
 */
public final class KiwiDebugAdapter {
    private record BreakpointSpec(
        String className,
        int line,
        String condition,
        String hitCondition,
        String logMessage,
        boolean temporary
    ) {}
    private record ExceptionSpec(String className, boolean caught, boolean uncaught) {}

    /**
     * A field being written to, or read from.
     *
     * The classic debugging question is not "where does this run" but "who put
     * that there", and a line breakpoint cannot answer it: the write may be in
     * a class nobody suspected. JDI watches the field itself.
     */
    private record WatchpointSpec(String className, String fieldName, boolean onWrite, boolean onRead) {}

    /** A method being entered, wherever it is called from. */
    private record MethodSpec(String className, String methodName, boolean onEntry, boolean onExit) {}

    private final Object stateLock = new Object();
    private final List<BreakpointSpec> breakpoints = new CopyOnWriteArrayList<>();
    private final List<ExceptionSpec> exceptions = new CopyOnWriteArrayList<>();
    private final List<WatchpointSpec> watchpoints = new CopyOnWriteArrayList<>();
    private final List<MethodSpec> methodBreakpoints = new CopyOnWriteArrayList<>();
    private final Map<Long, ObjectReference> references = new ConcurrentHashMap<>();
    private final Map<String, List<EventRequest>> installedWatchpoints = new ConcurrentHashMap<>();
    private final Map<String, List<EventRequest>> installedMethodBreakpoints = new ConcurrentHashMap<>();
    private final Map<String, BreakpointRequest> installedBreakpoints = new ConcurrentHashMap<>();
    private final Map<BreakpointRequest, Long> breakpointHits = new ConcurrentHashMap<>();
    private volatile VirtualMachine vm;
    private volatile EventSet suspendedEventSet;
    private volatile ThreadReference selectedThread;
    private volatile boolean running = true;

    public static void main(String[] args) {
        if (args.length < 2) {
            System.err.println("Usage: KiwiDebugAdapter <host> <port>");
            System.exit(2);
        }
        try {
            new KiwiDebugAdapter().run(args[0], args[1]);
        } catch (Throwable failure) {
            emit("ERROR", encoded(failure.toString()));
            failure.printStackTrace(System.err);
            System.exit(1);
        }
    }

    private void run(String host, String port) throws Exception {
        vm = attach(host, port);
        configureRequests();
        Thread commands = Thread.ofPlatform().name("kiwi-debug-commands").daemon(true).start(this::commandLoop);
        emit("READY");
        eventLoop();
        running = false;
        commands.interrupt();
    }

    private static VirtualMachine attach(String host, String port) throws Exception {
        VirtualMachineManager manager = Bootstrap.virtualMachineManager();
        AttachingConnector connector = manager.attachingConnectors().stream()
            .filter(candidate -> candidate.name().equals("com.sun.jdi.SocketAttach"))
            .findFirst()
            .orElseThrow(() -> new IllegalStateException("JDI SocketAttach connector not available"));
        Map<String, Connector.Argument> arguments = connector.defaultArguments();
        arguments.get("hostname").setValue(host);
        arguments.get("port").setValue(port);
        arguments.get("timeout").setValue("10000");
        return connector.attach(arguments);
    }

    private void configureRequests() {
        EventRequestManager manager = vm.eventRequestManager();
        ClassPrepareRequest prepare = manager.createClassPrepareRequest();
        prepare.setSuspendPolicy(EventRequest.SUSPEND_ALL);
        prepare.enable();
    }

    private void commandLoop() {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8))) {
            String line;
            while (running && (line = reader.readLine()) != null) {
                try {
                    handleCommand(line);
                } catch (Throwable failure) {
                    emit("ERROR", encoded(failure.getMessage() == null ? failure.toString() : failure.getMessage()));
                }
            }
        } catch (IOException failure) {
            if (running) emit("ERROR", encoded(failure.toString()));
        }
    }

    private void handleCommand(String commandLine) throws Exception {
        String[] parts = commandLine.split("\\t", -1);
        String command = parts[0];
        switch (command) {
            case "break" -> {
                BreakpointSpec spec = new BreakpointSpec(
                    decoded(parts, 1),
                    integer(parts, 2),
                    decoded(parts, 3),
                    decoded(parts, 4),
                    decoded(parts, 5),
                    false
                );
                breakpoints.add(spec);
                installBreakpoint(spec);
            }
            case "runToCursor" -> {
                BreakpointSpec spec = new BreakpointSpec(decoded(parts, 1), integer(parts, 2), "", "", "", true);
                breakpoints.add(spec);
                installBreakpoint(spec);
                resume();
            }
            case "restartFrame" -> restartFrame();
            case "clearBreakpoints" -> clearBreakpoints();
            case "exception" -> {
                ExceptionSpec spec = new ExceptionSpec(decoded(parts, 1), bool(parts, 2), bool(parts, 3));
                exceptions.add(spec);
                installException(spec);
            }
            case "clearExceptions" -> clearExceptions();
            case "watch" -> {
                WatchpointSpec spec = new WatchpointSpec(
                    decoded(parts, 1), decoded(parts, 2), bool(parts, 3), bool(parts, 4));
                watchpoints.add(spec);
                installWatchpoint(spec);
            }
            case "clearWatchpoints" -> clearWatchpoints();
            case "methodBreak" -> {
                MethodSpec spec = new MethodSpec(
                    decoded(parts, 1), decoded(parts, 2), bool(parts, 3), bool(parts, 4));
                methodBreakpoints.add(spec);
                installMethodBreakpoint(spec);
            }
            case "clearMethodBreakpoints" -> clearMethodBreakpoints();
            case "continue" -> resume();
            case "pause" -> pause();
            case "stepInto" -> step(StepRequest.STEP_INTO);
            case "stepOver" -> step(StepRequest.STEP_OVER);
            case "stepOut" -> step(StepRequest.STEP_OUT);
            case "stack" -> emitStack(selectedThread);
            case "locals" -> emitLocals(selectedThread);
            case "variables" -> emitReference(longValue(parts, 1));
            case "threads" -> emitThreads();
            case "selectThread" -> selectThread(longValue(parts, 1));
            case "evaluate" -> evaluate(decoded(parts, 1));
            case "setVariable" -> setVariable(decoded(parts, 1), decoded(parts, 2));
            case "hotReplace" -> hotReplace(parts);
            case "exit" -> {
                running = false;
                try { vm.dispose(); } catch (Throwable ignored) {}
            }
            default -> emit("ERROR", encoded("Unknown adapter command: " + command));
        }
    }

    private void eventLoop() throws Exception {
        while (running) {
            EventSet set;
            try {
                set = vm.eventQueue().remove();
            } catch (InterruptedException ignored) {
                continue;
            } catch (Throwable disconnected) {
                break;
            }
            boolean keepSuspended = false;
            for (Event event : set) {
                if (event instanceof VMStartEvent) {
                    continue;
                }
                if (event instanceof ClassPrepareEvent prepared) {
                    String preparedName = prepared.referenceType().name();
                    for (BreakpointSpec spec : breakpoints) {
                        if (matchesClass(preparedName, spec.className())) installBreakpoint(spec);
                    }
                    // A field breakpoint set before the class was loaded has no
                    // Field to watch yet; this is when it gets one.
                    for (WatchpointSpec spec : watchpoints) {
                        if (matchesClass(preparedName, spec.className())) installWatchpoint(prepared.referenceType(), spec);
                    }
                    continue;
                }
                if (event instanceof BreakpointEvent breakpoint) {
                    selectedThread = breakpoint.thread();
                    BreakpointRequest request = (BreakpointRequest) breakpoint.request();
                    String condition = String.valueOf(request.getProperty("condition"));
                    if (!condition.isBlank() && !evaluateCondition(selectedThread, condition)) continue;
                    long hitCount = breakpointHits.merge(request, 1L, Long::sum);
                    String hitCondition = String.valueOf(request.getProperty("hitCondition"));
                    if (!matchesHitCondition(hitCondition, hitCount)) continue;
                    String logMessage = String.valueOf(request.getProperty("logMessage"));
                    boolean temporary = Boolean.TRUE.equals(request.getProperty("temporary"));
                    if (temporary) removeBreakpointRequest(request);
                    if (!logMessage.isBlank()) {
                        emit("OUTPUT", encoded(renderLogMessage(selectedThread, logMessage) + "\n"));
                        continue;
                    }
                    keepSuspended = true;
                    pauseAt(set, selectedThread, breakpoint.location(), temporary ? "runToCursor" : "breakpoint");
                    break;
                }
                if (event instanceof WatchpointEvent watchpoint) {
                    selectedThread = watchpoint.thread();
                    keepSuspended = true;
                    boolean written = watchpoint instanceof ModificationWatchpointEvent;
                    ModificationWatchpointEvent modification =
                        written ? (ModificationWatchpointEvent) watchpoint : null;
                    // What the field held, and — when it is being written — what
                    // it is about to hold. The second is the whole reason to
                    // stop here, and it is gone by the time the next line runs.
                    emit(
                        "FIELDHIT",
                        encoded(watchpoint.field().declaringType().name()),
                        encoded(watchpoint.field().name()),
                        written ? "write" : "read",
                        encoded(renderValue(watchpoint.valueCurrent())),
                        encoded(modification == null ? "" : renderValue(modification.valueToBe()))
                    );
                    pauseAt(set, selectedThread, watchpoint.location(), written ? "fieldWrite" : "fieldRead");
                    break;
                }
                if (event instanceof MethodEntryEvent entry) {
                    if (!matchesMethod(entry.request(), entry.method().name())) continue;
                    selectedThread = entry.thread();
                    keepSuspended = true;
                    pauseAt(set, selectedThread, entry.location(), "methodEntry");
                    break;
                }
                if (event instanceof MethodExitEvent exit) {
                    if (!matchesMethod(exit.request(), exit.method().name())) continue;
                    selectedThread = exit.thread();
                    keepSuspended = true;
                    // The return value is the reason to stop on an exit at all.
                    emit(
                        "METHODEXIT",
                        encoded(exit.method().declaringType().name()),
                        encoded(exit.method().name()),
                        encoded(returnValueOf(exit))
                    );
                    pauseAt(set, selectedThread, exit.location(), "methodExit");
                    break;
                }
                if (event instanceof StepEvent step) {
                    selectedThread = step.thread();
                    deleteStepRequests();
                    keepSuspended = true;
                    pauseAt(set, selectedThread, step.location(), "step");
                    break;
                }
                if (event instanceof ExceptionEvent exception) {
                    if (!matchesException(exception)) continue;
                    selectedThread = exception.thread();
                    keepSuspended = true;
                    pauseAt(set, selectedThread, exception.location(), "exception");
                    emit("EXCEPTION", encoded(exception.exception().referenceType().name()), encoded(renderValue(exception.exception())));
                    break;
                }
                if (event instanceof VMDeathEvent || event instanceof VMDisconnectEvent) {
                    running = false;
                    emit("STATE", "stopped", "0", "", "0", "exit");
                    break;
                }
            }
            if (!keepSuspended) set.resume();
        }
    }

    private void pauseAt(EventSet set, ThreadReference thread, Location location, String reason) {
        synchronized (stateLock) {
            suspendedEventSet = set;
        }
        references.clear();
        emit(
            "STATE",
            "paused",
            Long.toString(thread.uniqueID()),
            encoded(location.declaringType().name()),
            Integer.toString(location.lineNumber()),
            reason
        );
        emitStack(thread);
        emitLocals(thread);
        emitThreads();
    }

    private void clearBreakpoints() {
        breakpoints.clear();
        EventRequestManager manager = vm.eventRequestManager();
        manager.deleteEventRequests(new ArrayList<>(manager.breakpointRequests()));
        installedBreakpoints.clear();
        breakpointHits.clear();
    }

    private void installBreakpoint(BreakpointSpec spec) {
        for (ReferenceType type : vm.classesByName(spec.className())) installBreakpoint(type, spec);
    }

    private void installBreakpoint(ReferenceType type, BreakpointSpec spec) {
        try {
            List<Location> locations = type.locationsOfLine(spec.line());
            if (locations.isEmpty()) {
                locations = type.allLineLocations().stream()
                    .min(Comparator.comparingInt(location -> Math.abs(location.lineNumber() - spec.line())))
                    .map(List::of)
                    .orElse(List.of());
            }
            if (locations.isEmpty()) return;
            Location location = locations.getFirst();
            String key = type.name() + ":" + location.codeIndex() + ":" + spec.condition()
                + ":" + spec.hitCondition() + ":" + spec.logMessage() + ":" + spec.temporary();
            if (installedBreakpoints.containsKey(key)) return;
            BreakpointRequest request = vm.eventRequestManager().createBreakpointRequest(location);
            request.setSuspendPolicy(EventRequest.SUSPEND_ALL);
            request.putProperty("condition", spec.condition() == null ? "" : spec.condition());
            request.putProperty("hitCondition", spec.hitCondition() == null ? "" : spec.hitCondition());
            request.putProperty("logMessage", spec.logMessage() == null ? "" : spec.logMessage());
            request.putProperty("temporary", spec.temporary());
            request.enable();
            installedBreakpoints.put(key, request);
            emit("BREAKPOINT", encoded(type.name()), Integer.toString(location.lineNumber()), "verified");
        } catch (Throwable failure) {
            emit("BREAKPOINT", encoded(spec.className()), Integer.toString(spec.line()), "failed");
        }
    }

    /**
     * Watches a field, in every class already loaded that carries it.
     *
     * Not every VM can do this — `canWatchFieldModification` is optional in the
     * JDI specification, and a VM that cannot is better off saying so than
     * silently never stopping.
     */
    private void installWatchpoint(WatchpointSpec spec) {
        for (ReferenceType type : vm.classesByName(spec.className())) installWatchpoint(type, spec);
    }

    private void installWatchpoint(ReferenceType type, WatchpointSpec spec) {
        try {
            Field field = type.fieldByName(spec.fieldName());
            if (field == null) {
                emit("WATCHPOINT", encoded(spec.className()), encoded(spec.fieldName()), "failed",
                    encoded("Feld nicht gefunden"));
                return;
            }
            EventRequestManager manager = vm.eventRequestManager();
            String key = type.name() + "#" + field.name();
            if (installedWatchpoints.containsKey(key)) return;
            List<EventRequest> created = new ArrayList<>();
            if (spec.onWrite()) {
                if (!vm.canWatchFieldModification()) {
                    emit("WATCHPOINT", encoded(spec.className()), encoded(spec.fieldName()), "failed",
                        encoded("Die JVM unterstützt keine Feld-Breakpoints"));
                    return;
                }
                ModificationWatchpointRequest request = manager.createModificationWatchpointRequest(field);
                request.setSuspendPolicy(EventRequest.SUSPEND_ALL);
                request.enable();
                created.add(request);
            }
            if (spec.onRead()) {
                if (!vm.canWatchFieldAccess()) {
                    emit("WATCHPOINT", encoded(spec.className()), encoded(spec.fieldName()), "failed",
                        encoded("Die JVM unterstützt keine Lese-Breakpoints"));
                } else {
                    AccessWatchpointRequest request = manager.createAccessWatchpointRequest(field);
                    request.setSuspendPolicy(EventRequest.SUSPEND_ALL);
                    request.enable();
                    created.add(request);
                }
            }
            if (created.isEmpty()) return;
            installedWatchpoints.put(key, created);
            emit("WATCHPOINT", encoded(type.name()), encoded(field.name()), "verified", encoded(""));
        } catch (Throwable failure) {
            emit("WATCHPOINT", encoded(spec.className()), encoded(spec.fieldName()), "failed",
                encoded(String.valueOf(failure.getMessage())));
        }
    }

    private void clearWatchpoints() {
        watchpoints.clear();
        EventRequestManager manager = vm.eventRequestManager();
        manager.deleteEventRequests(new ArrayList<>(manager.modificationWatchpointRequests()));
        manager.deleteEventRequests(new ArrayList<>(manager.accessWatchpointRequests()));
        installedWatchpoints.clear();
    }

    /**
     * Stops on entering a method, wherever it is called from.
     *
     * JDI has no "breakpoint on this method": there is a request for entering
     * any method at all, narrowed by a class filter. So the class filter does
     * the coarse work and the event handler checks the name — which is also why
     * an overloaded name stops on every overload, and should.
     */
    private void installMethodBreakpoint(MethodSpec spec) {
        try {
            EventRequestManager manager = vm.eventRequestManager();
            String key = spec.className() + "#" + spec.methodName();
            if (installedMethodBreakpoints.containsKey(key)) return;
            List<EventRequest> created = new ArrayList<>();
            if (spec.onEntry()) {
                MethodEntryRequest request = manager.createMethodEntryRequest();
                request.addClassFilter(spec.className());
                request.setSuspendPolicy(EventRequest.SUSPEND_ALL);
                request.putProperty("method", spec.methodName());
                request.enable();
                created.add(request);
            }
            if (spec.onExit()) {
                MethodExitRequest request = manager.createMethodExitRequest();
                request.addClassFilter(spec.className());
                request.setSuspendPolicy(EventRequest.SUSPEND_ALL);
                request.putProperty("method", spec.methodName());
                request.enable();
                created.add(request);
            }
            if (created.isEmpty()) return;
            installedMethodBreakpoints.put(key, created);
            emit("METHODBREAK", encoded(spec.className()), encoded(spec.methodName()), "verified", encoded(""));
        } catch (Throwable failure) {
            emit("METHODBREAK", encoded(spec.className()), encoded(spec.methodName()), "failed",
                encoded(String.valueOf(failure.getMessage())));
        }
    }

    private void clearMethodBreakpoints() {
        methodBreakpoints.clear();
        EventRequestManager manager = vm.eventRequestManager();
        manager.deleteEventRequests(new ArrayList<>(manager.methodEntryRequests()));
        manager.deleteEventRequests(new ArrayList<>(manager.methodExitRequests()));
        installedMethodBreakpoints.clear();
    }

    private void clearExceptions() {
        exceptions.clear();
        EventRequestManager manager = vm.eventRequestManager();
        manager.deleteEventRequests(new ArrayList<>(manager.exceptionRequests()));
    }

    private void installException(ExceptionSpec spec) {
        ExceptionRequest request = vm.eventRequestManager().createExceptionRequest(null, spec.caught(), spec.uncaught());
        request.setSuspendPolicy(EventRequest.SUSPEND_ALL);
        request.putProperty("className", spec.className());
        request.enable();
    }

    private boolean matchesException(ExceptionEvent event) {
        String actual = event.exception().referenceType().name();
        for (ExceptionSpec spec : exceptions) {
            if (spec.className().isBlank()
                || actual.equals(spec.className())
                || actual.endsWith("." + spec.className())
                || inherits(event.exception().referenceType(), spec.className())) {
                return true;
            }
        }
        return false;
    }

    private static boolean inherits(ReferenceType type, String expected) {
        if (!(type instanceof ClassType classType)) return false;
        for (ClassType candidate = classType; candidate != null; candidate = candidate.superclass()) {
            if (candidate.name().equals(expected) || candidate.name().endsWith("." + expected)) return true;
        }
        return false;
    }

    private void resume() {
        synchronized (stateLock) {
            if (suspendedEventSet != null) {
                suspendedEventSet.resume();
                suspendedEventSet = null;
            } else {
                vm.resume();
            }
        }
        emit("STATE", "running", selectedThread == null ? "0" : Long.toString(selectedThread.uniqueID()), "", "0", "continue");
    }

    private void pause() {
        vm.suspend();
        ThreadReference thread = selectedThread;
        if (thread == null || !thread.isSuspended()) {
            thread = preferredThread();
        }
        selectedThread = thread;
        Location location = topLocation(thread);
        if (thread != null && location != null) pauseAt(null, thread, location, "pause");
    }

    private void step(int depth) {
        ThreadReference thread = selectedThread;
        if (thread == null) throw new IllegalStateException("No selected debug thread");
        deleteStepRequests();
        StepRequest request = vm.eventRequestManager().createStepRequest(thread, StepRequest.STEP_LINE, depth);
        request.addCountFilter(1);
        request.addClassExclusionFilter("java.*");
        request.addClassExclusionFilter("jdk.*");
        request.addClassExclusionFilter("sun.*");
        request.setSuspendPolicy(EventRequest.SUSPEND_ALL);
        request.enable();
        resume();
    }

    private void deleteStepRequests() {
        EventRequestManager manager = vm.eventRequestManager();
        manager.deleteEventRequests(new ArrayList<>(manager.stepRequests()));
    }

    private void removeBreakpointRequest(BreakpointRequest request) {
        String className = request.location().declaringType().name();
        int line = request.location().lineNumber();
        try {
            vm.eventRequestManager().deleteEventRequest(request);
        } catch (Throwable ignored) {}
        breakpointHits.remove(request);
        installedBreakpoints.entrySet().removeIf(entry -> entry.getValue() == request);
        breakpoints.removeIf(spec -> spec.temporary()
            && matchesClass(className, spec.className())
            && line == spec.line());
    }

    private void restartFrame() {
        ThreadReference thread = selectedThread;
        if (thread == null || !thread.isSuspended()) {
            throw new IllegalStateException(
                "Kein angehaltener Thread ausgewählt. Halte den Debugger an und wähle den Thread, dessen Methode neu laufen soll.");
        }
        if (!vm.canPopFrames()) throw new UnsupportedOperationException("Diese JVM kann keine Stack-Frames zurücksetzen.");
        try {
            thread.popFrames(thread.frame(0));
            Location location = topLocation(thread);
            if (location == null) throw new IllegalStateException("No stack frame remains");
            references.clear();
            emit(
                "STATE",
                "paused",
                Long.toString(thread.uniqueID()),
                encoded(location.declaringType().name()),
                Integer.toString(location.lineNumber()),
                "restartFrame"
            );
            emitStack(thread);
            emitLocals(thread);
        } catch (Throwable failure) {
            throw new IllegalStateException(restartFrameFailure(thread, failure), failure);
        }
    }

    private void emitStack(ThreadReference thread) {
        if (thread == null || !thread.isSuspended()) return;
        try {
            int index = 0;
            StringBuilder text = new StringBuilder();
            for (StackFrame frame : thread.frames()) {
                Location location = frame.location();
                String source;
                try { source = location.sourceName(); } catch (Throwable ignored) { source = ""; }
                emit(
                    "STACK",
                    Integer.toString(index),
                    Long.toString(thread.uniqueID()),
                    encoded(location.declaringType().name()),
                    encoded(location.method().name()),
                    encoded(source),
                    Integer.toString(location.lineNumber())
                );
                text.append(location.declaringType().name())
                    .append('.').append(location.method().name())
                    .append(" (").append(source).append(':').append(location.lineNumber()).append(")\n");
                index++;
            }
            emit("STACK_END", Long.toString(thread.uniqueID()));
            emit("OUTPUT", encoded(text.toString()));
        } catch (Throwable failure) {
            emit("ERROR", encoded("Stack: " + failure.getMessage()));
        }
    }

    private void emitLocals(ThreadReference thread) {
        if (thread == null || !thread.isSuspended()) return;
        try {
            StackFrame frame = thread.frame(0);
            List<LocalVariable> variables = frame.visibleVariables();
            Map<LocalVariable, Value> values = frame.getValues(variables);
            StringBuilder text = new StringBuilder();
            if (frame.thisObject() != null) emitVariable("locals", "this", frame.thisObject(), frame.thisObject().referenceType().name());
            for (LocalVariable variable : variables) {
                Value value = values.get(variable);
                emitVariable("locals", variable.name(), value, variable.typeName());
                text.append(variable.name()).append(" = ").append(renderValue(value)).append('\n');
            }
            emit("VARS_END", "locals");
            emit("OUTPUT", encoded(text.toString()));
        } catch (Throwable failure) {
            emit("ERROR", encoded("Locals: " + failure.getMessage()));
        }
    }

    private void emitReference(long referenceId) {
        ObjectReference reference = references.get(referenceId);
        if (reference == null) {
            emit("ERROR", encoded("Object reference expired"));
            return;
        }
        String scope = Long.toString(referenceId);
        try {
            if (reference instanceof ArrayReference array) {
                int limit = Math.min(array.length(), 500);
                List<Value> values = array.getValues(0, limit);
                for (int index = 0; index < values.size(); index++) {
                    Value value = values.get(index);
                    emitVariable(scope, "[" + index + "]", value, value == null ? "null" : value.type().name());
                }
                if (array.length() > limit) {
                    emit("VAR", scope, encoded("…"), encoded((array.length() - limit) + " weitere Elemente"), encoded(""), "0", "false");
                }
            } else if (!emitLogicalCollection(reference, scope)) {
                List<Field> fields = new ArrayList<>(reference.referenceType().allFields());
                fields.sort(Comparator.comparing(Field::name));
                Map<Field, Value> values = reference.getValues(fields);
                for (Field field : fields) {
                    emitVariable(scope, field.name(), values.get(field), field.typeName());
                }
            }
            emit("VARS_END", scope);
        } catch (Throwable failure) {
            emit("ERROR", encoded("Variables: " + failure.getMessage()));
        }
    }

    /**
     * Collections are shown as logical elements instead of exposing only JDK
     * implementation fields such as ArrayList.elementData or HashMap.table.
     * Invocation happens only while the selected debug thread is suspended.
     * Custom implementations that reject invocation safely fall back to fields.
     */
    private boolean emitLogicalCollection(ObjectReference reference, String scope) {
        if (selectedThread == null || !selectedThread.isSuspended()) return false;
        try {
            ObjectReference collection = reference;
            String label = "element";
            if (implementsInterface(reference.referenceType(), "java.util.Map")) {
                Value entries = invoke(reference, "entrySet", "()Ljava/util/Set;", List.of());
                if (!(entries instanceof ObjectReference entrySet)) return false;
                collection = entrySet;
                label = "entry";
            } else if (!implementsInterface(reference.referenceType(), "java.util.Collection")) {
                return false;
            }
            Value values = invoke(collection, "toArray", "()[Ljava/lang/Object;", List.of());
            if (!(values instanceof ArrayReference array)) return false;
            int limit = Math.min(array.length(), 500);
            for (int index = 0; index < limit; index++) {
                Value value = array.getValue(index);
                emitVariable(scope, "[" + index + "]", value, value == null ? label : value.type().name());
            }
            if (array.length() > limit) {
                emit("VAR", scope, encoded("…"), encoded((array.length() - limit) + " weitere Elemente"), encoded(""), "0", "false");
            }
            return true;
        } catch (Throwable ignored) {
            return false;
        }
    }

    private Value invoke(ObjectReference reference, String name, String signature, List<? extends Value> arguments) throws Exception {
        Method method = reference.referenceType() instanceof ClassType classType
            ? classType.concreteMethodByName(name, signature)
            : reference.referenceType().methodsByName(name, signature).stream().findFirst().orElse(null);
        if (method == null) throw new IllegalArgumentException("Method not found: " + name + signature);
        return reference.invokeMethod(selectedThread, method, new ArrayList<>(arguments), ObjectReference.INVOKE_SINGLE_THREADED);
    }

    private static boolean implementsInterface(ReferenceType type, String interfaceName) {
        if (type.name().equals(interfaceName)) return true;
        return type instanceof ClassType classType
            && classType.allInterfaces().stream().anyMatch(candidate -> candidate.name().equals(interfaceName));
    }

    private void emitVariable(String scope, String name, Value value, String type) {
        long referenceId = 0;
        boolean hasChildren = false;
        if (value instanceof ObjectReference reference) {
            referenceId = reference.uniqueID();
            references.put(referenceId, reference);
            hasChildren = reference instanceof ArrayReference array ? array.length() > 0 : !reference.referenceType().allFields().isEmpty();
        }
        emit(
            "VAR",
            scope,
            encoded(name),
            encoded(renderValue(value)),
            encoded(type == null ? "" : type),
            Long.toString(referenceId),
            Boolean.toString(hasChildren)
        );
    }

    private void emitThreads() {
        for (ThreadReference thread : vm.allThreads()) {
            emit(
                "THREAD",
                Long.toString(thread.uniqueID()),
                encoded(thread.name()),
                Integer.toString(thread.status()),
                Boolean.toString(thread.isSuspended()),
                Boolean.toString(selectedThread != null && selectedThread.uniqueID() == thread.uniqueID())
            );
        }
        emit("THREADS_END");
    }

    private void selectThread(long id) {
        selectedThread = vm.allThreads().stream().filter(thread -> thread.uniqueID() == id).findFirst()
            .orElseThrow(() -> new IllegalArgumentException("Thread not found: " + id));
        emitStack(selectedThread);
        emitLocals(selectedThread);
    }

    /**
     * Answers a Java expression typed at a breakpoint.
     *
     * The full evaluator is tried first; the old dotted-path resolver stays as
     * a fallback so a watch saved before this existed keeps working, and so a
     * parse failure still shows a value where it can.
     */
    private void evaluate(String expression) {
        Value value;
        try {
            value = ExpressionEvaluator.evaluate(selectedThread, selectedThread.frame(0), expression);
        } catch (ExpressionEvaluator.EvaluationException problem) {
            emit("OUTPUT", encoded(expression + " -> " + problem.getMessage() + "\\n"));
            value = resolveExpression(selectedThread, expression);
        } catch (Throwable ignored) {
            value = resolveExpression(selectedThread, expression);
        }
        emit("WATCH", encoded(expression), encoded(renderValue(value)), encoded(value == null ? "null" : value.type().name()),
            value instanceof ObjectReference reference ? Long.toString(reference.uniqueID()) : "0");
        if (value instanceof ObjectReference reference) references.put(reference.uniqueID(), reference);
        emit("OUTPUT", encoded(expression + " = " + renderValue(value) + "\n"));
    }

/**
     * Changes a variable while the program is stopped.
     *
     * The new value is an expression in its own right, so "count = other + 1"
     * and "name = person.title()" both work; what it evaluates to is what gets
     * assigned. After the change the locals are emitted again, because a value
     * that changed without the panel showing it looks like nothing happened.
     */
    private void setVariable(String target, String expression) {
        if (selectedThread == null || !selectedThread.isSuspended()) {
            emit("OUTPUT", encoded("Variablen lassen sich nur an einem Haltepunkt ändern.\n"));
            return;
        }
        try {
            StackFrame frame = selectedThread.frame(0);
            Value value = ExpressionEvaluator.evaluate(selectedThread, frame, expression);
            // The frame is fetched again: invoking a method during evaluation
            // resumes the thread briefly, which invalidates the old one.
            ExpressionEvaluator.assign(selectedThread, selectedThread.frame(0), target, value);
            emit("OUTPUT", encoded(target + " = " + renderValue(value) + "\n"));
            emitLocals(selectedThread);
        } catch (ExpressionEvaluator.EvaluationException problem) {
            emit("OUTPUT", encoded(target + " -> " + problem.getMessage() + "\n"));
        } catch (Throwable problem) {
            emit("OUTPUT", encoded(target + " -> " + problem + "\n"));
        }
    }

    private boolean evaluateCondition(ThreadReference thread, String expression) {
        try {
            String condition = expression.trim();
            for (String operator : List.of("==", "!=", ">=", "<=", ">", "<")) {
                int at = condition.indexOf(operator);
                if (at < 0) continue;
                Value left = resolveExpression(thread, condition.substring(0, at).trim());
                String rightText = condition.substring(at + operator.length()).trim();
                Object leftValue = scalar(left);
                Object rightValue = parseLiteral(rightText);
                int comparison = compare(leftValue, rightValue);
                return switch (operator) {
                    case "==" -> comparison == 0;
                    case "!=" -> comparison != 0;
                    case ">=" -> comparison >= 0;
                    case "<=" -> comparison <= 0;
                    case ">" -> comparison > 0;
                    case "<" -> comparison < 0;
                    default -> false;
                };
            }
            Value value = resolveExpression(thread, condition);
            return value instanceof BooleanValue bool ? bool.value() : value != null;
        } catch (Throwable ignored) {
            // Invalid conditions pause instead of silently losing a breakpoint.
            return true;
        }
    }

    private static boolean matchesHitCondition(String condition, long hitCount) {
        String value = condition == null ? "" : condition.trim();
        if (value.isBlank() || value.equals("null")) return true;
        try {
            if (value.startsWith(">=")) return hitCount >= Long.parseLong(value.substring(2).trim());
            if (value.startsWith(">")) return hitCount > Long.parseLong(value.substring(1).trim());
            if (value.startsWith("==")) return hitCount == Long.parseLong(value.substring(2).trim());
            if (value.startsWith("%")) {
                long divisor = Long.parseLong(value.substring(1).trim());
                return divisor > 0 && hitCount % divisor == 0;
            }
            return hitCount == Long.parseLong(value);
        } catch (NumberFormatException ignored) {
            // Invalid hit expressions stop so a user does not silently miss a breakpoint.
            return true;
        }
    }

    private String renderLogMessage(ThreadReference thread, String template) {
        Matcher matcher = Pattern.compile("\\{([^{}]+)}").matcher(template);
        StringBuffer output = new StringBuffer();
        while (matcher.find()) {
            Value value = resolveExpression(thread, matcher.group(1).trim());
            matcher.appendReplacement(output, Matcher.quoteReplacement(renderValue(value)));
        }
        matcher.appendTail(output);
        return output.toString();
    }

    private Value resolveExpression(ThreadReference thread, String expression) {
        if (thread == null || !thread.isSuspended()) return null;
        try {
            String[] path = expression.trim().split("\\.");
            StackFrame frame = thread.frame(0);
            Value current;
            if (path[0].equals("this")) {
                current = frame.thisObject();
            } else {
                LocalVariable variable = frame.visibleVariableByName(path[0]);
                current = variable == null ? null : frame.getValue(variable);
                if (current == null && frame.thisObject() != null) {
                    Field field = frame.thisObject().referenceType().fieldByName(path[0]);
                    current = field == null ? null : frame.thisObject().getValue(field);
                }
            }
            for (int index = 1; index < path.length && current instanceof ObjectReference reference; index++) {
                String part = path[index];
                if (reference instanceof ArrayReference array && part.matches("\\d+")) {
                    current = array.getValue(Integer.parseInt(part));
                } else {
                    Field field = reference.referenceType().fieldByName(part);
                    current = field == null ? null : reference.getValue(field);
                }
            }
            return current;
        } catch (Throwable ignored) {
            return null;
        }
    }

    private void hotReplace(String[] parts) {
        String operationId = parts.length > 1 ? decoded(parts, 1) : "";
        try {
            if (!vm.canRedefineClasses()) {
                throw new UnsupportedOperationException("Diese JVM unterstützt HotSwap nicht.");
            }
            if (parts.length < 4 || parts.length % 2 != 0) {
                throw new IllegalArgumentException("Ungültige HotSwap-Anfrage.");
            }
            Map<ReferenceType, byte[]> replacements = new HashMap<>();
            List<String> replacedNames = new ArrayList<>();
            for (int index = 2; index + 1 < parts.length; index += 2) {
                String className = decoded(parts, index);
                String classFile = decoded(parts, index + 1);
                List<ReferenceType> types = vm.classesByName(className);
                if (types.isEmpty()) continue;
                byte[] bytes = Files.readAllBytes(Path.of(classFile));
                for (ReferenceType type : types) replacements.put(type, bytes);
                replacedNames.add(className);
            }
            if (replacements.isEmpty()) throw new IllegalArgumentException("Keine der geänderten Klassen ist bereits geladen.");
            // JDI performs this as one atomic redefine. It may synchronize the
            // VM internally, but no suspend event is exposed and a running
            // debuggee remains running before, during and after HotSwap.
            vm.redefineClasses(replacements);
            references.clear();
            String label = replacedNames.size() == 1
                ? replacedNames.getFirst()
                : replacedNames.size() + " Klassen (inklusive innerer Klassen)";
            // HotSwap exchanges code, never state. Saying "updated" alone is
            // misleading for the common case: a method that has already run —
            // main having built a window, say — leaves every object it created
            // exactly as it was, and nothing visible changes. Reporting whether
            // the replaced code is still on a stack is the difference between
            // "took effect" and "will take effect the next time it is called".
            boolean onStack = isOnAnyStack(replacedNames);
            String effect = onStack
                ? " aktualisiert. Laufende Aufrufe behalten den alten Rumpf; der nächste Aufruf verwendet den neuen."
                : " aktualisiert. Der neue Code greift beim nächsten Aufruf — bereits erzeugte Objekte behalten ihren Zustand.";
            emit("HOT_REPLACE", "ok", encoded(operationId), encoded(label + effect));
        } catch (Throwable failure) {
            emit("HOT_REPLACE", "error", encoded(operationId), encoded(hotReplaceFailure(failure)));
        }
    }

    /** Whether any replaced class currently has a frame on some thread. */
    private boolean isOnAnyStack(List<String> classNames) {
        for (ThreadReference thread : vm.allThreads()) {
            List<StackFrame> frames;
            try {
                frames = thread.isSuspended() ? thread.frames() : List.of();
            } catch (Throwable ignored) {
                continue;
            }
            for (StackFrame frame : frames) {
                String declaring = frame.location().declaringType().name();
                for (String className : classNames) {
                    if (matchesClass(declaring, className)) return true;
                }
            }
        }
        return false;
    }

    /**
     * The thread a user means when they pause.
     *
     * JDI returns threads in whatever order the VM keeps them, so the first
     * suspended one is regularly a housekeeping thread such as the reference
     * handler or the finalizer. Its stack is native, its locals are empty, and
     * restarting a frame there cannot work — which reads as a broken debugger.
     */
    private ThreadReference preferredThread() {
        List<ThreadReference> suspended = vm.allThreads().stream().filter(ThreadReference::isSuspended).toList();
        if (suspended.isEmpty()) return null;
        for (ThreadReference thread : suspended) {
            if ("main".equals(thread.name())) return thread;
        }
        // Otherwise the topmost thread that is actually running project code.
        for (ThreadReference thread : suspended) {
            Location location = topLocation(thread);
            if (location == null) continue;
            String type = location.declaringType().name();
            if (!type.startsWith("java.") && !type.startsWith("jdk.") && !type.startsWith("sun.")) return thread;
        }
        return suspended.getFirst();
    }

    /** Explains a failed frame restart instead of reporting a null message. */
    private static String restartFrameFailure(ThreadReference thread, Throwable failure) {
        String detail = failure.getMessage() == null || failure.getMessage().isBlank()
            ? failure.getClass().getSimpleName()
            : failure.getMessage();
        Location location = topLocation(thread);
        boolean nativeFrame = location != null && location.method().isNative();
        if (nativeFrame || failure instanceof NativeMethodException) {
            return "Der oberste Frame von „" + threadName(thread) + "“ ist eine native Methode; die JVM kann ihn nicht zurücksetzen. "
                + "Wähle einen Thread, der Projektcode ausführt. (" + detail + ")";
        }
        if (failure instanceof IncompatibleThreadStateException) {
            return "Der Thread „" + threadName(thread) + "“ ist nicht angehalten. (" + detail + ")";
        }
        return "Frame konnte nicht zurückgesetzt werden: " + detail;
    }

    private static String threadName(ThreadReference thread) {
        try {
            return thread == null ? "?" : thread.name();
        } catch (Throwable ignored) {
            return "?";
        }
    }

    private static String hotReplaceFailure(Throwable failure) {
        String detail = failure.getMessage() == null ? failure.toString() : failure.getMessage();
        String normalized = detail.toLowerCase();
        if (failure instanceof UnsupportedOperationException
            || normalized.contains("add method")
            || normalized.contains("delete method")
            || normalized.contains("schema")
            || normalized.contains("field")
            || normalized.contains("hierarchy")) {
            return "Die laufende JVM kann diese Strukturänderung nicht übernehmen. "
                + "Ändere nur Methodenrümpfe oder starte Debug neu. Details: " + detail;
        }
        return detail;
    }

    private static Location topLocation(ThreadReference thread) {
        if (thread == null) return null;
        try { return thread.frame(0).location(); } catch (Throwable ignored) { return null; }
    }

    /**
     * Whether a method event is the method that was asked for.
     *
     * The class filter on the request is as narrow as JDI gets; every other
     * method in the same class arrives here too, and a debugger that stopped on
     * all of them would be unusable.
     */
    /**
     * The value a method is returning, where the VM will say.
     *
     * `returnValue` is optional in the JDI specification, and asking a VM that
     * cannot answer throws rather than answering nothing.
     */
    private static String returnValueOf(MethodExitEvent event) {
        try {
            return renderValue(event.returnValue());
        } catch (Throwable unsupported) {
            return "";
        }
    }

    private static boolean matchesMethod(EventRequest request, String actual) {
        String wanted = String.valueOf(request.getProperty("method"));
        return wanted.isBlank() || wanted.equals("null") || wanted.equals(actual);
    }

    private static boolean matchesClass(String actual, String expected) {
        return actual.equals(expected) || actual.startsWith(expected + "$");
    }

    private static Object scalar(Value value) {
        if (value == null) return null;
        if (value instanceof StringReference string) return string.value();
        String rendered = value.toString();
        if (rendered.equals("true") || rendered.equals("false")) return Boolean.parseBoolean(rendered);
        try { return Double.parseDouble(rendered); } catch (NumberFormatException ignored) { return rendered; }
    }

    private static Object parseLiteral(String text) {
        if (text.equals("null")) return null;
        if (text.equals("true") || text.equals("false")) return Boolean.parseBoolean(text);
        if (text.length() >= 2 && text.startsWith("\"") && text.endsWith("\"")) return text.substring(1, text.length() - 1);
        try { return Double.parseDouble(text.replaceAll("[fFdDlL]$", "")); } catch (NumberFormatException ignored) { return text; }
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private static int compare(Object left, Object right) {
        if (left == null || right == null) return left == right ? 0 : left == null ? -1 : 1;
        if (left instanceof Number l && right instanceof Number r) return Double.compare(l.doubleValue(), r.doubleValue());
        if (left instanceof Comparable comparable && left.getClass().isInstance(right)) return comparable.compareTo(right);
        return String.valueOf(left).compareTo(String.valueOf(right));
    }

    private static String renderValue(Value value) {
        if (value == null) return "null";
        if (value instanceof StringReference string) {
            String text = string.value();
            return "\"" + (text.length() > 180 ? text.substring(0, 177) + "…" : text) + "\"";
        }
        if (value instanceof ArrayReference array) return array.referenceType().name() + "[" + array.length() + "]";
        if (value instanceof ObjectReference object) return object.referenceType().name() + "@" + object.uniqueID();
        return value.toString();
    }

    private static int integer(String[] parts, int index) {
        return Integer.parseInt(parts[index]);
    }

    private static long longValue(String[] parts, int index) {
        return Long.parseLong(parts[index]);
    }

    private static boolean bool(String[] parts, int index) {
        return Boolean.parseBoolean(parts[index]);
    }

    private static String decoded(String[] parts, int index) {
        if (index >= parts.length || parts[index].isEmpty()) return "";
        return new String(Base64.getDecoder().decode(parts[index]), StandardCharsets.UTF_8);
    }

    private static String encoded(String value) {
        return Base64.getEncoder().encodeToString(String.valueOf(value == null ? "" : value).getBytes(StandardCharsets.UTF_8));
    }

    private static synchronized void emit(String type, String... values) {
        StringBuilder line = new StringBuilder("KIWI\t").append(type);
        for (String value : values) line.append('\t').append(value == null ? "" : value);
        System.out.println(line);
        System.out.flush();
    }
}
