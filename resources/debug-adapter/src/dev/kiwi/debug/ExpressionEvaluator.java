package dev.kiwi.debug;

import com.sun.jdi.ArrayReference;
import com.sun.jdi.BooleanValue;
import com.sun.jdi.ClassType;
import com.sun.jdi.Field;
import com.sun.jdi.IntegerValue;
import com.sun.jdi.InterfaceType;
import com.sun.jdi.InvocationException;
import com.sun.jdi.LocalVariable;
import com.sun.jdi.Method;
import com.sun.jdi.ObjectReference;
import com.sun.jdi.PrimitiveValue;
import com.sun.jdi.ReferenceType;
import com.sun.jdi.StackFrame;
import com.sun.jdi.StringReference;
import com.sun.jdi.ThreadReference;
import com.sun.jdi.Type;
import com.sun.jdi.Value;
import com.sun.jdi.VirtualMachine;

import java.util.ArrayList;
import java.util.List;

/**
 * Evaluates a Java expression against a suspended thread.
 *
 * The debugger used to resolve only a dotted path — "order.customer.name", and
 * an array index written as "items.0". Everything a person actually types at a
 * breakpoint was refused: a method call, a comparison, a sum, a literal to
 * compare against.
 *
 * This is a recursive-descent parser over the part of Java that means something
 * at a breakpoint: literals, locals and fields, array indexing, method calls,
 * the arithmetic, comparison and logical operators, instanceof, and the
 * conditional. It deliberately stops short of anything that declares or
 * allocates — no `new`, no lambdas, no casts to arbitrary types. Those change
 * the program being debugged rather than asking it a question.
 *
 * Calling a method does run code inside the debuggee, which is what makes
 * `list.size()` work at all; JDI requires the thread to be suspended for it,
 * and it is.
 */
final class ExpressionEvaluator {
    private final ThreadReference thread;
    private final StackFrame frame;
    private final VirtualMachine vm;
    private final String source;
    private int position;

    private ExpressionEvaluator(ThreadReference thread, StackFrame frame, String source) {
        this.thread = thread;
        this.frame = frame;
        this.vm = thread.virtualMachine();
        this.source = source;
    }

    /** Thrown for anything the evaluator cannot make sense of. */
    static final class EvaluationException extends RuntimeException {
        EvaluationException(String message) {
            super(message);
        }
    }

    static Value evaluate(ThreadReference thread, StackFrame frame, String expression) {
        ExpressionEvaluator evaluator = new ExpressionEvaluator(thread, frame, expression);
        Value value = evaluator.parseExpression();
        evaluator.skipSpace();
        if (evaluator.position < evaluator.source.length()) {
            throw new EvaluationException("Unerwartetes Zeichen bei Position " + evaluator.position);
        }
        return value;
    }

    /**
     * Assigns to a local variable or a field.
     *
     * The target is parsed as far as its last step so the thing being assigned
     * to is known as a place rather than as a value — "count", "this.total",
     * "order.items[2]" are each a different kind of place, and only the last
     * step decides which.
     */
    static void assign(ThreadReference thread, StackFrame frame, String target, Value value) {
        String path = target.trim();
        if (path.isEmpty()) throw new EvaluationException("Kein Ziel angegeben.");
        int lastDot = topLevelLastIndexOf(path, '.');
        if (lastDot < 0) {
            LocalVariable local = visibleVariable(frame, path);
            if (local != null) {
                try {
                    frame.setValue(local, value);
                    return;
                } catch (Exception error) {
                    throw new EvaluationException("Die Variable konnte nicht gesetzt werden: " + error.getMessage());
                }
            }
            ObjectReference self = frame.thisObject();
            Field field = self == null ? null : self.referenceType().fieldByName(path);
            if (self == null || field == null) throw new EvaluationException("Unbekannte Variable: " + path);
            setField(self, field, value);
            return;
        }
        String ownerText = path.substring(0, lastDot);
        String member = path.substring(lastDot + 1).trim();
        Value owner = evaluate(thread, frame, ownerText);
        if (owner instanceof ArrayReference array && member.matches("\\d+")) {
            try {
                array.setValue(Integer.parseInt(member), value);
                return;
            } catch (Exception error) {
                throw new EvaluationException("Der Arrayeintrag konnte nicht gesetzt werden: " + error.getMessage());
            }
        }
        if (!(owner instanceof ObjectReference reference)) {
            throw new EvaluationException("Auf " + ownerText + " lässt sich nichts zuweisen.");
        }
        Field field = reference.referenceType().fieldByName(member);
        if (field == null) throw new EvaluationException("Unbekanntes Feld: " + member);
        setField(reference, field, value);
    }

    private static void setField(ObjectReference reference, Field field, Value value) {
        try {
            reference.setValue(field, value);
        } catch (Exception error) {
            throw new EvaluationException("Das Feld konnte nicht gesetzt werden: " + error.getMessage());
        }
    }

    /** The last dot that is not inside brackets or a string. */
    private static int topLevelLastIndexOf(String text, char wanted) {
        int depth = 0;
        boolean inString = false;
        int found = -1;
        for (int index = 0; index < text.length(); index++) {
            char character = text.charAt(index);
            if (inString) {
                if (character == '\\') index++;
                else if (character == '"') inString = false;
                continue;
            }
            if (character == '"') inString = true;
            else if (character == '(' || character == '[') depth++;
            else if (character == ')' || character == ']') depth--;
            else if (character == wanted && depth == 0) found = index;
        }
        return found;
    }

    private static LocalVariable visibleVariable(StackFrame frame, String name) {
        try {
            return frame.visibleVariableByName(name);
        } catch (Exception ignored) {
            return null;
        }
    }

    // ---- the grammar, loosest binding first ----

    private Value parseExpression() {
        Value condition = parseOr();
        skipSpace();
        if (!consume("?")) return condition;
        Value whenTrue = parseExpression();
        skipSpace();
        if (!consume(":")) throw new EvaluationException("Im Bedingungsausdruck fehlt ':'.");
        Value whenFalse = parseExpression();
        return truth(condition) ? whenTrue : whenFalse;
    }

    private Value parseOr() {
        Value left = parseAnd();
        while (true) {
            skipSpace();
            if (!consume("||")) return left;
            // Short-circuiting matters: the right side may call a method, and
            // "list != null || list.size() > 0" must not call it.
            if (truth(left)) {
                parseAnd();
                left = vm.mirrorOf(true);
            } else {
                left = vm.mirrorOf(truth(parseAnd()));
            }
        }
    }

    private Value parseAnd() {
        Value left = parseEquality();
        while (true) {
            skipSpace();
            if (!consume("&&")) return left;
            if (!truth(left)) {
                parseEquality();
                left = vm.mirrorOf(false);
            } else {
                left = vm.mirrorOf(truth(parseEquality()));
            }
        }
    }

    private Value parseEquality() {
        Value left = parseRelational();
        while (true) {
            skipSpace();
            if (consume("==")) left = vm.mirrorOf(equalValues(left, parseRelational()));
            else if (consume("!=")) left = vm.mirrorOf(!equalValues(left, parseRelational()));
            else return left;
        }
    }

    private Value parseRelational() {
        Value left = parseAdditive();
        while (true) {
            skipSpace();
            if (consumeWord("instanceof")) {
                left = vm.mirrorOf(isInstanceOf(left, readTypeName()));
            } else if (consume("<=")) left = vm.mirrorOf(compareNumbers(left, parseAdditive()) <= 0);
            else if (consume(">=")) left = vm.mirrorOf(compareNumbers(left, parseAdditive()) >= 0);
            else if (consume("<")) left = vm.mirrorOf(compareNumbers(left, parseAdditive()) < 0);
            else if (consume(">")) left = vm.mirrorOf(compareNumbers(left, parseAdditive()) > 0);
            else return left;
        }
    }

    private Value parseAdditive() {
        Value left = parseMultiplicative();
        while (true) {
            skipSpace();
            if (consume("+")) {
                Value right = parseMultiplicative();
                // A string on either side makes it concatenation, as in Java.
                left = isString(left) || isString(right)
                    ? vm.mirrorOf(text(left) + text(right))
                    : arithmetic('+', left, right);
            } else if (consume("-")) left = arithmetic('-', left, parseMultiplicative());
            else return left;
        }
    }

    private Value parseMultiplicative() {
        Value left = parseUnary();
        while (true) {
            skipSpace();
            if (consume("*")) left = arithmetic('*', left, parseUnary());
            else if (consume("/")) left = arithmetic('/', left, parseUnary());
            else if (consume("%")) left = arithmetic('%', left, parseUnary());
            else return left;
        }
    }

    private Value parseUnary() {
        skipSpace();
        if (consume("!")) return vm.mirrorOf(!truth(parseUnary()));
        if (consume("-")) return arithmetic('-', vm.mirrorOf(0), parseUnary());
        if (consume("+")) return parseUnary();
        return parsePostfix();
    }

    private Value parsePostfix() {
        Value current = parsePrimary();
        while (true) {
            skipSpace();
            if (consume("[")) {
                Value index = parseExpression();
                skipSpace();
                if (!consume("]")) throw new EvaluationException("']' fehlt.");
                current = arrayElement(current, index);
            } else if (consume(".")) {
                String name = readIdentifier();
                skipSpace();
                current = peek("(")
                    ? invoke(current, name, readArguments())
                    : member(current, name);
            } else {
                return current;
            }
        }
    }

    private Value parsePrimary() {
        skipSpace();
        if (position >= source.length()) throw new EvaluationException("Der Ausdruck bricht ab.");
        char character = source.charAt(position);
        if (consume("(")) {
            Value value = parseExpression();
            skipSpace();
            if (!consume(")")) throw new EvaluationException("')' fehlt.");
            return value;
        }
        if (character == '"') return vm.mirrorOf(readString());
        if (character == '\'') return vm.mirrorOf(readChar());
        if (Character.isDigit(character)) return readNumber();
        if (Character.isJavaIdentifierStart(character)) {
            int start = position;
            String name = readIdentifier();
            if (name.equals("true")) return vm.mirrorOf(true);
            if (name.equals("false")) return vm.mirrorOf(false);
            if (name.equals("null")) return null;
            if (name.equals("new")) throw new EvaluationException("'new' wird im Debugger nicht ausgewertet.");
            skipSpace();
            if (peek("(")) return invoke(frame.thisObject(), name, readArguments());
            Value resolved = resolveName(name);
            if (resolved != NOT_FOUND) return resolved;
            // Not a variable, so it may be the start of a class name for a
            // static access: "Integer.MAX_VALUE", "System.out".
            position = start;
            return staticTarget();
        }
        throw new EvaluationException("Unerwartetes Zeichen: " + character);
    }

    /** Distinguishes "resolved to null" from "no such name", which null cannot. */
    private static final Value NOT_FOUND = new NotFound();

    private static final class NotFound implements Value {
        @Override public VirtualMachine virtualMachine() { return null; }
        @Override public Type type() { return null; }
    }

    private Value resolveName(String name) {
        if (name.equals("this")) return frame.thisObject();
        LocalVariable local = visibleVariable(frame, name);
        if (local != null) return frame.getValue(local);
        ObjectReference self = frame.thisObject();
        if (self != null) {
            Field field = self.referenceType().fieldByName(name);
            if (field != null) return self.getValue(field);
        }
        ReferenceType owner = frame.location().declaringType();
        Field staticField = owner.fieldByName(name);
        if (staticField != null && staticField.isStatic()) return owner.getValue(staticField);
        return NOT_FOUND;
    }

    /**
     * Reads a dotted class name and answers with the type it names.
     *
     * Tried longest-first: "java.util.List" is a class, while "order.items" is
     * a field on a local. Only the name that a loaded class actually answers to
     * is accepted, so nothing is guessed.
     */
    private Value staticTarget() {
        int start = position;
        StringBuilder name = new StringBuilder(readIdentifier());
        ReferenceType found = null;
        int foundEnd = position;
        while (true) {
            List<ReferenceType> matches = vm.classesByName(name.toString());
            if (!matches.isEmpty()) {
                found = matches.get(0);
                foundEnd = position;
            }
            int save = position;
            skipSpace();
            if (!consume(".")) {
                position = save;
                break;
            }
            skipSpace();
            if (position >= source.length() || !Character.isJavaIdentifierStart(source.charAt(position))) {
                position = save;
                break;
            }
            name.append('.').append(readIdentifier());
        }
        if (found == null) {
            position = start;
            throw new EvaluationException("Unbekannter Name: " + readIdentifier());
        }
        position = foundEnd;
        return new StaticType(found);
    }

    /** A class named in an expression, standing in for its static members. */
    private static final class StaticType implements Value {
        private final ReferenceType type;

        StaticType(ReferenceType type) {
            this.type = type;
        }

        @Override public VirtualMachine virtualMachine() { return type.virtualMachine(); }
        @Override public Type type() { return type; }
    }

    private Value member(Value owner, String name) {
        if (owner instanceof StaticType statics) {
            Field field = statics.type.fieldByName(name);
            if (field == null) throw new EvaluationException("Unbekanntes statisches Feld: " + name);
            return statics.type.getValue(field);
        }
        if (owner instanceof ArrayReference array && name.equals("length")) {
            return vm.mirrorOf(array.length());
        }
        if (owner instanceof ArrayReference array && name.matches("\\d+")) {
            // The old dotted form, kept so saved watch expressions still work.
            return array.getValue(Integer.parseInt(name));
        }
        if (!(owner instanceof ObjectReference reference)) {
            throw new EvaluationException("Auf " + name + " kann hier nicht zugegriffen werden.");
        }
        Field field = reference.referenceType().fieldByName(name);
        if (field == null) throw new EvaluationException("Unbekanntes Feld: " + name);
        return reference.getValue(field);
    }

    private Value arrayElement(Value owner, Value index) {
        if (!(owner instanceof ArrayReference array)) throw new EvaluationException("Kein Array.");
        int at = (int) longOf(index);
        if (at < 0 || at >= array.length()) {
            throw new EvaluationException("Index " + at + " liegt außerhalb von 0.." + (array.length() - 1) + ".");
        }
        return array.getValue(at);
    }

    /**
     * Calls a method in the debuggee.
     *
     * This genuinely runs code in the program being debugged, which is the only
     * way "list.size()" or "toString()" can answer. Overloads are chosen by
     * argument count and then by whether the arguments fit, because JDI gives
     * no resolution of its own.
     */
    private Value invoke(Value owner, String name, List<Value> arguments) {
        if (owner instanceof StaticType statics) {
            if (!(statics.type instanceof ClassType classType)) {
                throw new EvaluationException("Statischer Aufruf ist hier nicht möglich.");
            }
            Method method = pick(classType.methodsByName(name), arguments, true);
            try {
                return classType.invokeMethod(thread, method, arguments, ObjectReference.INVOKE_SINGLE_THREADED);
            } catch (InvocationException error) {
                throw new EvaluationException("Die Methode hat eine Ausnahme geworfen: "
                    + error.exception().referenceType().name());
            } catch (Exception error) {
                throw new EvaluationException("Aufruf fehlgeschlagen: " + error.getMessage());
            }
        }
        if (!(owner instanceof ObjectReference reference)) {
            throw new EvaluationException("Auf " + name + "() kann hier nicht zugegriffen werden.");
        }
        Method method = pick(reference.referenceType().methodsByName(name), arguments, false);
        try {
            return reference.invokeMethod(thread, method, arguments, ObjectReference.INVOKE_SINGLE_THREADED);
        } catch (InvocationException error) {
            throw new EvaluationException("Die Methode hat eine Ausnahme geworfen: "
                + error.exception().referenceType().name());
        } catch (Exception error) {
            throw new EvaluationException("Aufruf fehlgeschlagen: " + error.getMessage());
        }
    }

    private Method pick(List<Method> candidates, List<Value> arguments, boolean wantStatic) {
        Method fallback = null;
        for (Method method : candidates) {
            if (method.isAbstract()) continue;
            if (wantStatic && !method.isStatic()) continue;
            if (method.argumentTypeNames().size() != arguments.size()) continue;
            if (fallback == null) fallback = method;
            if (fits(method, arguments)) return method;
        }
        if (fallback != null) return fallback;
        throw new EvaluationException("Keine passende Methode für " + arguments.size() + " Argument(e).");
    }

    private boolean fits(Method method, List<Value> arguments) {
        List<String> wanted = method.argumentTypeNames();
        for (int index = 0; index < wanted.size(); index++) {
            Value argument = arguments.get(index);
            if (argument == null) continue;
            String type = wanted.get(index);
            boolean primitiveWanted = !type.contains(".") && !type.endsWith("[]");
            if (primitiveWanted != (argument instanceof PrimitiveValue)) return false;
        }
        return true;
    }

    private List<Value> readArguments() {
        if (!consume("(")) throw new EvaluationException("'(' fehlt.");
        List<Value> arguments = new ArrayList<>();
        skipSpace();
        if (consume(")")) return arguments;
        while (true) {
            arguments.add(parseExpression());
            skipSpace();
            if (consume(")")) return arguments;
            if (!consume(",")) throw new EvaluationException("',' oder ')' fehlt.");
        }
    }

    // ---- values ----

    private boolean truth(Value value) {
        if (value instanceof BooleanValue bool) return bool.value();
        return value != null;
    }

    private boolean isString(Value value) {
        return value instanceof StringReference;
    }

    private String text(Value value) {
        if (value == null) return "null";
        if (value instanceof StringReference string) return string.value();
        if (value instanceof ObjectReference reference) {
            try {
                Value rendered = invoke(reference, "toString", List.of());
                return rendered instanceof StringReference string ? string.value() : String.valueOf(rendered);
            } catch (RuntimeException ignored) {
                return reference.type().name() + "@" + reference.uniqueID();
            }
        }
        return value.toString();
    }

    private boolean equalValues(Value left, Value right) {
        if (left == null || right == null) return left == right;
        if (left instanceof PrimitiveValue && right instanceof PrimitiveValue) {
            return compareNumbers(left, right) == 0;
        }
        // Reference identity, as == is in Java. equals() is a method call and
        // is written as one.
        return left.equals(right);
    }

    private int compareNumbers(Value left, Value right) {
        if (left instanceof StringReference a && right instanceof StringReference b) {
            return a.value().compareTo(b.value());
        }
        double a = doubleOf(left);
        double b = doubleOf(right);
        return Double.compare(a, b);
    }

    private Value arithmetic(char operator, Value left, Value right) {
        if (isFloating(left) || isFloating(right)) {
            double a = doubleOf(left);
            double b = doubleOf(right);
            double result = switch (operator) {
                case '+' -> a + b;
                case '-' -> a - b;
                case '*' -> a * b;
                case '/' -> b == 0 ? Double.NaN : a / b;
                case '%' -> b == 0 ? Double.NaN : a % b;
                default -> throw new EvaluationException("Unbekannter Operator " + operator);
            };
            return vm.mirrorOf(result);
        }
        long a = longOf(left);
        long b = longOf(right);
        if ((operator == '/' || operator == '%') && b == 0) {
            throw new EvaluationException("Division durch null.");
        }
        long result = switch (operator) {
            case '+' -> a + b;
            case '-' -> a - b;
            case '*' -> a * b;
            case '/' -> a / b;
            case '%' -> a % b;
            default -> throw new EvaluationException("Unbekannter Operator " + operator);
        };
        // Stays an int where both sides were, so "1 + 1" does not read as 2L.
        return isLong(left) || isLong(right) || result > Integer.MAX_VALUE || result < Integer.MIN_VALUE
            ? vm.mirrorOf(result)
            : vm.mirrorOf((int) result);
    }

    private boolean isFloating(Value value) {
        String name = value == null || value.type() == null ? "" : value.type().name();
        return name.equals("float") || name.equals("double");
    }

    private boolean isLong(Value value) {
        return value != null && value.type() != null && value.type().name().equals("long");
    }

    private double doubleOf(Value value) {
        if (value instanceof PrimitiveValue primitive) return primitive.doubleValue();
        if (value == null) throw new EvaluationException("null lässt sich nicht vergleichen.");
        Value unboxed = unbox(value);
        if (unboxed instanceof PrimitiveValue primitive) return primitive.doubleValue();
        throw new EvaluationException("Kein Zahlenwert: " + value.type().name());
    }

    private long longOf(Value value) {
        if (value instanceof PrimitiveValue primitive) return primitive.longValue();
        Value unboxed = value == null ? null : unbox(value);
        if (unboxed instanceof PrimitiveValue primitive) return primitive.longValue();
        throw new EvaluationException("Kein ganzzahliger Wert.");
    }

    /** Integer, Long, Double and friends carry their primitive in "value". */
    private Value unbox(Value value) {
        if (!(value instanceof ObjectReference reference)) return value;
        Field field = reference.referenceType().fieldByName("value");
        return field == null ? value : reference.getValue(field);
    }

    /**
     * Whether a value is of a type, walking the hierarchy by hand.
     *
     * JDI has no assignability test between two ReferenceTypes, so the classes
     * above the value's own and every interface it carries are compared by
     * name. The name may be written plain or fully qualified — somebody at a
     * breakpoint types "List", not "java.util.List".
     */
    private boolean isInstanceOf(Value value, String typeName) {
        if (!(value instanceof ObjectReference reference)) return false;
        ReferenceType actual = reference.referenceType();
        if (namesType(actual, typeName)) return true;
        if (actual instanceof ClassType classType) {
            for (ClassType parent = classType.superclass(); parent != null; parent = parent.superclass()) {
                if (namesType(parent, typeName)) return true;
            }
            for (InterfaceType face : classType.allInterfaces()) {
                if (namesType(face, typeName)) return true;
            }
        }
        if (actual instanceof InterfaceType face) {
            for (InterfaceType parent : face.superinterfaces()) {
                if (namesType(parent, typeName)) return true;
            }
        }
        return false;
    }

    private static boolean namesType(ReferenceType type, String wanted) {
        String name = type.name();
        return name.equals(wanted) || name.endsWith("." + wanted);
    }

    // ---- reading the text ----

    private void skipSpace() {
        while (position < source.length() && Character.isWhitespace(source.charAt(position))) position++;
    }

    private boolean peek(String token) {
        skipSpace();
        return source.startsWith(token, position);
    }

    private boolean consume(String token) {
        skipSpace();
        if (!source.startsWith(token, position)) return false;
        // "<" must not swallow the "<" of "<=", so the longer forms are tried
        // first by the caller; here only "=" needs guarding against "==".
        if (token.equals("=") && source.startsWith("==", position)) return false;
        position += token.length();
        return true;
    }

    private boolean consumeWord(String word) {
        skipSpace();
        if (!source.startsWith(word, position)) return false;
        int after = position + word.length();
        if (after < source.length() && Character.isJavaIdentifierPart(source.charAt(after))) return false;
        position = after;
        return true;
    }

    private String readIdentifier() {
        skipSpace();
        int start = position;
        while (position < source.length() && Character.isJavaIdentifierPart(source.charAt(position))) position++;
        if (start == position) throw new EvaluationException("Name erwartet.");
        return source.substring(start, position);
    }

    private String readTypeName() {
        skipSpace();
        int start = position;
        while (position < source.length()
            && (Character.isJavaIdentifierPart(source.charAt(position)) || source.charAt(position) == '.')) {
            position++;
        }
        if (start == position) throw new EvaluationException("Typname erwartet.");
        return source.substring(start, position);
    }

    private String readString() {
        position++;
        StringBuilder text = new StringBuilder();
        while (position < source.length() && source.charAt(position) != '"') {
            char character = source.charAt(position++);
            if (character == '\\' && position < source.length()) {
                char escape = source.charAt(position++);
                text.append(switch (escape) {
                    case 'n' -> '\n';
                    case 't' -> '\t';
                    case 'r' -> '\r';
                    case '0' -> '\0';
                    default -> escape;
                });
            } else {
                text.append(character);
            }
        }
        if (position >= source.length()) throw new EvaluationException("Die Zeichenkette wird nicht geschlossen.");
        position++;
        return text.toString();
    }

    private char readChar() {
        position++;
        if (position >= source.length()) throw new EvaluationException("Zeichen erwartet.");
        char character = source.charAt(position++);
        if (character == '\\' && position < source.length()) {
            char escape = source.charAt(position++);
            character = switch (escape) {
                case 'n' -> '\n';
                case 't' -> '\t';
                case 'r' -> '\r';
                case '0' -> '\0';
                default -> escape;
            };
        }
        if (position >= source.length() || source.charAt(position) != '\'') {
            throw new EvaluationException("'\\'' fehlt.");
        }
        position++;
        return character;
    }

    private Value readNumber() {
        int start = position;
        boolean floating = false;
        while (position < source.length()) {
            char character = source.charAt(position);
            if (Character.isDigit(character)) position++;
            else if (character == '.' && position + 1 < source.length()
                && Character.isDigit(source.charAt(position + 1))) {
                floating = true;
                position++;
            } else if (character == 'L' || character == 'l') {
                position++;
                return vm.mirrorOf(Long.parseLong(source.substring(start, position - 1)));
            } else if (character == 'd' || character == 'D' || character == 'f' || character == 'F') {
                position++;
                return vm.mirrorOf(Double.parseDouble(source.substring(start, position - 1)));
            } else {
                break;
            }
        }
        String text = source.substring(start, position);
        if (floating) return vm.mirrorOf(Double.parseDouble(text));
        long parsed = Long.parseLong(text);
        return parsed > Integer.MAX_VALUE || parsed < Integer.MIN_VALUE
            ? vm.mirrorOf(parsed)
            : vm.mirrorOf((int) parsed);
    }

    /** Kept so callers can render an int without knowing the JDI type. */
    static int intOf(Value value) {
        return value instanceof IntegerValue integer ? integer.value() : 0;
    }
}
