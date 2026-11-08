import { describe, expect, it } from "vitest";
import {
  bracketBalance,
  completeNewExpression,
  genericArity,
  hasOpenTernary,
  hasTopLevelAssignment,
  localMemberCompletions,
  maskJavaLiterals,
  memberAccessReceiver,
  methodCallSnippet,
  methodNameProposals,
  needsStatementSemicolon,
  enclosingMethodAt,
  parseJavaMembers,
} from "./java-completion";

const source = [
  "package de.beispiel;",
  "",
  "import java.util.List;",
  "",
  "public class Person {",
  "    private final String name;",
  "    private int alter = 0;",
  "    private static final List<String> ROLLEN = List.of();",
  "",
  "    public Person(String name) {",
  "        this.name = name;",
  "    }",
  "",
  "    public String name(){}",
  "",
  "    public void setAlter(int alter) {",
  "        this.alter = alter;",
  "    }",
  "",
  "    private boolean istVolljaehrig(int grenze, String grund) {",
  "        return alter >= grenze;",
  "    }",
  "",
  "    static List<String> rollen() {",
  "        return ROLLEN;",
  "    }",
  "}",
].join("\n");

describe("reading what a file declares", () => {
  it("recognises a method written without a space before the brace", () => {
    // The shape the user reported: `public String name(){}` was invisible to
    // everything that looked for a declaration, so it could not be completed.
    const method = parseJavaMembers(source).methods.find((entry) => entry.name === "name");
    expect(method).toMatchObject({ name: "name", returnType: "String", visibility: "public", isStatic: false });
    expect(method?.parameters).toEqual([]);
  });

  it("keeps the parameters with their types and names", () => {
    const method = parseJavaMembers(source).methods.find((entry) => entry.name === "istVolljaehrig");
    expect(method?.returnType).toBe("boolean");
    expect(method?.parameters).toEqual([
      { type: "int", name: "grenze" },
      { type: "String", name: "grund" },
    ]);
  });

  it("tells a static method from an instance one", () => {
    const methods = parseJavaMembers(source).methods;
    expect(methods.find((entry) => entry.name === "rollen")?.isStatic).toBe(true);
    expect(methods.find((entry) => entry.name === "setAlter")?.isStatic).toBe(false);
  });

  it("marks the constructor as one rather than as a method", () => {
    const constructor = parseJavaMembers(source).methods.find((entry) => entry.isConstructor);
    expect(constructor).toMatchObject({ name: "Person", owner: "Person" });
  });

  it("reads the fields, generics and initialiser included", () => {
    const fields = parseJavaMembers(source).fields;
    expect(fields.map((field) => field.name)).toEqual(["name", "alter", "ROLLEN"]);
    expect(fields.find((field) => field.name === "ROLLEN")).toMatchObject({
      type: "List<String>",
      isStatic: true,
    });
  });

  it("names the type the members belong to", () => {
    const parsed = parseJavaMembers(source);
    expect(parsed.types).toEqual([{ name: "Person", kind: "class", line: 5 }]);
    expect(parsed.methods.every((method) => method.owner === "Person")).toBe(true);
  });

  it("does not mistake a control structure for a declaration", () => {
    // `while (ready) {` and `if (x) {` have the same shape as a method header
    // if the keyword is ignored, and inventing a method called `ready` would
    // put a call in the completion list that cannot compile.
    const parsed = parseJavaMembers([
      "class A {",
      "    void run() {",
      "        while (ready) {",
      "        }",
      "        if (check(1)) {",
      "        }",
      "        for (String value : values) {",
      "        }",
      "        return new Runnable() {",
      "        };",
      "    }",
      "}",
    ].join("\n"));
    expect(parsed.methods.map((method) => method.name)).toEqual(["run"]);
  });

  it("ignores anything inside a comment or a string", () => {
    const parsed = parseJavaMembers([
      "class A {",
      "    // public String versteckt() {}",
      "    /* public int auchVersteckt() {} */",
      "    String text = \"public void imText() {}\";",
      "    public int echt() { return 1; }",
      "}",
    ].join("\n"));
    expect(parsed.methods.map((method) => method.name)).toEqual(["echt"]);
    expect(parsed.fields.map((field) => field.name)).toEqual(["text"]);
  });

  it("reads an interface method that has no body", () => {
    const parsed = parseJavaMembers([
      "interface Speicher {",
      "    void schreibe(String inhalt);",
      "    String lies();",
      "}",
    ].join("\n"));
    expect(parsed.methods.map((method) => method.name)).toEqual(["schreibe", "lies"]);
    expect(parsed.types[0]).toMatchObject({ name: "Speicher", kind: "interface" });
  });

  it("finds nothing in an empty file rather than failing", () => {
    expect(parseJavaMembers("")).toEqual({ types: [], methods: [], fields: [] });
    expect(parseJavaMembers("   \n\n")).toEqual({ types: [], methods: [], fields: [] });
  });
});

describe("blanking comments and literals", () => {
  it("keeps the text exactly as long as it was", () => {
    const text = 'a = "text"; // Kommentar\n/* zwei\nZeilen */ b;';
    expect(maskJavaLiterals(text)).toHaveLength(text.length);
    expect(maskJavaLiterals(text).split("\n")).toHaveLength(text.split("\n").length);
  });

  it("hides a brace that only lives inside a string", () => {
    expect(bracketBalance(maskJavaLiterals('String s = "{{{";'))).toBe(0);
  });

  it("survives an escaped quote and a text block", () => {
    // The escaped quote does not end the literal, so everything up to the real
    // closing quote has to disappear and the semicolon after it has to stay.
    const escaped = 'String s = "er sagte \\"hallo\\"";';
    expect(maskJavaLiterals(escaped)).toHaveLength(escaped.length);
    expect(maskJavaLiterals(escaped)).not.toContain("hallo");
    expect(maskJavaLiterals(escaped).trimEnd().endsWith(";")).toBe(true);
    expect(maskJavaLiterals('String s = """\nmehrzeilig\n""";')).not.toContain("mehrzeilig");
  });
});

describe("finishing a new expression", () => {
  const context = (line: string, after = "", arity = 1) => ({
    lineBeforeCursor: line,
    lineAfterCursor: after,
    arity,
    finishStatements: true,
  });

  it("adds the diamond, the call and the semicolon in one go", () => {
    // Typing `new ArrayList` and accepting the proposal left exactly that:
    // three more edits before the line compiled.
    expect(completeNewExpression("ArrayList", context("List<String> namen = new ArrayList")))
      .toBe("ArrayList<>(${0});");
  });

  it("leaves the diamond off a type that takes no type arguments", () => {
    expect(completeNewExpression("StringBuilder", context("var b = new StringBuilder", "", 0)))
      .toBe("StringBuilder(${0});");
  });

  it("adds no semicolon inside an argument list", () => {
    expect(completeNewExpression("HashMap", context("verbrauche(new HashMap", "", 2)))
      .toBe("HashMap<>(${0})");
  });

  it("adds no semicolon when something still follows on the line", () => {
    expect(completeNewExpression("ArrayList", context("List<String> a = new ArrayList", ", b")))
      .toBe("ArrayList<>(${0})");
  });

  it("finishes a return the same way", () => {
    expect(completeNewExpression("ArrayList", context("        return new ArrayList")))
      .toBe("ArrayList<>(${0});");
  });

  it("leaves a proposal that already brought its own shape alone", () => {
    // JDT resolves the type arguments where it can, and its answer wins.
    expect(completeNewExpression("ArrayList<>()", context("var a = new ArrayList")))
      .toBe("ArrayList<>()");
    expect(completeNewExpression("ArrayList<String>()", context("var a = new ArrayList")))
      .toBe("ArrayList<String>()");
  });

  it("changes nothing where there is no new at all", () => {
    expect(completeNewExpression("ArrayList", context("var a = Array"))).toBe("ArrayList");
    expect(completeNewExpression("size", context("liste.siz"))).toBe("size");
  });

  it("leaves the semicolon out while the setting is off", () => {
    expect(completeNewExpression("ArrayList", {
      lineBeforeCursor: "List<String> a = new ArrayList",
      lineAfterCursor: "",
      arity: 1,
      finishStatements: false,
    })).toBe("ArrayList<>(${0})");
  });
});

describe("how many type arguments a type takes", () => {
  it("believes the label over any list", () => {
    expect(genericArity("ArrayList<E>")).toBe(1);
    expect(genericArity("HashMap<K,V>")).toBe(2);
    expect(genericArity("Map.Entry<K, V>", "java.util")).toBe(2);
  });

  it("knows the everyday JDK types by name", () => {
    expect(genericArity("ArrayList")).toBe(1);
    expect(genericArity("HashMap")).toBe(2);
    expect(genericArity("Optional")).toBe(1);
  });

  it("says none for a type that takes none", () => {
    expect(genericArity("StringBuilder")).toBe(0);
    expect(genericArity("Person")).toBe(0);
    expect(genericArity("")).toBe(0);
  });
});

describe("finishing a statement with a semicolon", () => {
  const yes = (line: string) => expect({ line, semicolon: needsStatementSemicolon(line, "") })
    .toEqual({ line, semicolon: true });
  const no = (line: string, after = "") => expect({ line, semicolon: needsStatementSemicolon(line, after) })
    .toEqual({ line, semicolon: false });

  it("finishes an assignment that is not a call", () => {
    yes("        int summe = a + b");
    yes('        String name = "Kiwi"');
    yes("        return summe");
    yes("import java.util.List");
  });

  it("does not prematurely finish an open ternary expression", () => {
    no('        return LeafCloud.get().players().get("").get().isBedrock() ? ""');
    no('        var mode = LeafCloud.get().players().get("").get().isBedrock() ? ""');
    no("        boolean b = isReady ? true");
    yes('        return LeafCloud.get().players().get("").get().isBedrock() ? "" : ""');
    yes('        var mode = LeafCloud.get().players().get("").get().isBedrock() ? "" : ""');
  });

  /**
   * A call is the one thing that can always be continued on the next line.
   *
   * `.build()` written under `TerminalBuilder.builder()` is one statement, and
   * a semicolon after the first line breaks it — which is what it did. So a
   * call ends a statement only where nothing can follow it.
   */
  it("waits at a call whose value could still be used", () => {
    no("        this.terminal = TerminalBuilder.builder()");
    no("        var builder = TerminalBuilder.builder()");
    no("        liste.add(wert)");
    no("        System.out.println(text)");
  });

  it("finishes a call that is known to return nothing", () => {
    expect(needsStatementSemicolon("        System.out.println(text)", "", {
      callReturnType: "void",
    })).toBe(true);
    expect(needsStatementSemicolon("        this.terminal = TerminalBuilder.builder()", "", {
      callReturnType: "TerminalBuilder",
    })).toBe(false);
  });

  it("finishes a call to a void method this very file declares", () => {
    const members = parseJavaMembers([
      "class Server {",
      "    void shutdown() {}",
      "    String name() { return \"\"; }",
      "}",
    ].join("\n"));
    expect(needsStatementSemicolon("        shutdown()", "", { members })).toBe(true);
    expect(needsStatementSemicolon("        this.shutdown()", "", { members })).toBe(true);
    expect(needsStatementSemicolon("        name()", "", { members })).toBe(false);
    // A call reaching somewhere the buffer says nothing about stays unknown.
    expect(needsStatementSemicolon("        other.shutdown()", "", { members })).toBe(false);
  });

  it("still finishes a constructor call, which nothing can follow", () => {
    yes("        this(name)");
    yes("        super(name)");
    yes("        throw new IllegalStateException(text)");
  });

  it("finishes a declaration that has no initialiser", () => {
    yes("        List<String> namen");
    yes("        int zaehler");
  });

  it("leaves a line alone that is obviously still being written", () => {
    no("        int summe = a +");
    no("        liste.add(");
    no("        int summe = compute(a,");
    no("        var x = liste.");
    no("        wert = ");
  });

  it("leaves a block header alone", () => {
    no("        if (bereit)");
    no("        while (bereit)");
    no("        for (String wert : werte)");
    no("        try");
    no("        } else");
    no("    public String name()");
    no("    private static void main(String[] args)");
    no("    public class Person");
    no("    @Override");
  });

  it("adds nothing where a semicolon is already there", () => {
    no("        int summe = a + b;");
    no("        }");
    no("        liste.add(wert) ;");
  });

  it("keeps out of a comment", () => {
    no("        // int summe = a + b");
    no("        int summe = a + b // Kommentar");
    no("        /* int summe = 1 */");
  });

  it("does nothing when the caret is not at the end of the line", () => {
    no("        int summe = a", " + b");
    no("        liste.add(wert)", ";");
  });

  it("does nothing on an empty line", () => {
    no("");
    no("        ");
  });

  it("leaves an unterminated string alone", () => {
    // The line does not parse yet; finishing it would be a guess.
    no('        String s = "offen');
  });
});

describe("telling an assignment from a comparison", () => {
  it("finds the assignment", () => {
    expect(hasTopLevelAssignment("int a = 1")).toBe(true);
    expect(hasTopLevelAssignment("a = b")).toBe(true);
  });

  it("does not call a comparison one", () => {
    expect(hasTopLevelAssignment("if (a == b)")).toBe(false);
    expect(hasTopLevelAssignment("if (a != b)")).toBe(false);
    expect(hasTopLevelAssignment("if (a <= b)")).toBe(false);
    expect(hasTopLevelAssignment("a += 1")).toBe(false);
  });

  it("ignores one inside brackets, where it belongs to something else", () => {
    expect(hasTopLevelAssignment("for (int i = 0; i < n; i++)")).toBe(false);
  });
});

describe("suggesting a name for the method being declared", () => {
  const members = parseJavaMembers(source);
  const context = (line: string) => ({
    lineBeforeCursor: line,
    fields: members.fields,
    methods: members.methods,
  });

  it("offers a getter for a field of the same type", () => {
    const names = methodNameProposals(context("    public String get")).map((entry) => entry.name);
    expect(names).toContain("getName");
  });

  it("writes the body of the getter, not only its name", () => {
    const getter = methodNameProposals(context("    public String get")).find((entry) => entry.name === "getName");
    expect(getter?.insertText).toContain("return name;");
  });

  it("offers a setter once the return type is void", () => {
    const names = methodNameProposals(context("    public void set")).map((entry) => entry.name);
    expect(names).toContain("setName");
    expect(names).not.toContain("getName");
  });

  it("writes the assignment a setter is made of", () => {
    const setter = methodNameProposals(context("    public void set")).find((entry) => entry.name === "setAlter2");
    expect(setter).toBeUndefined();
    const forName = methodNameProposals(context("    public void set")).find((entry) => entry.name === "setName");
    expect(forName?.insertText).toContain("this.name = name;");
  });

  it("turns a boolean into a question", () => {
    const names = methodNameProposals(context("    public boolean is")).map((entry) => entry.name);
    expect(names.every((name) => /^(?:is|has)/.test(name))).toBe(true);
    expect(names).toContain("isEmpty");
  });

  it("never offers a name the class already uses", () => {
    // `setAlter` exists, so proposing it again would produce a duplicate
    // method rather than save any typing.
    const names = methodNameProposals(context("    public void ")).map((entry) => entry.name);
    expect(names).not.toContain("setAlter");
  });

  it("narrows down as more of the name is typed", () => {
    const names = methodNameProposals(context("    public void st")).map((entry) => entry.name);
    expect(names).toEqual(["start", "stop"]);
  });

  it("keeps a static method away from the instance fields", () => {
    const names = methodNameProposals(context("    public static String get")).map((entry) => entry.name);
    expect(names).not.toContain("getName");
  });

  it("says nothing where no declaration is being written", () => {
    expect(methodNameProposals(context("        liste.add"))).toEqual([]);
    expect(methodNameProposals(context("        return na"))).toEqual([]);
    expect(methodNameProposals(context(""))).toEqual([]);
  });
});

describe("completing what the file itself declares", () => {
  const members = parseJavaMembers(source);

  it("offers a method that was just written a few lines up", () => {
    const completions = localMemberCompletions(members, { lineBeforeCursor: "        var x = na", line: 17 });
    expect(completions.map((entry) => entry.label)).toContain("name()");
  });

  it("shows the parameters a method takes", () => {
    const completions = localMemberCompletions(members, { lineBeforeCursor: "        ist", line: 17 });
    expect(completions.map((entry) => entry.label)).toContain("istVolljaehrig(int, String)");
  });

  it("fills the arguments in as placeholders to overwrite", () => {
    const method = members.methods.find((entry) => entry.name === "istVolljaehrig")!;
    expect(methodCallSnippet(method)).toBe("istVolljaehrig(${1:grenze}, ${2:grund})${0}");
  });

  it("leaves the caret after a call that takes nothing", () => {
    const method = members.methods.find((entry) => entry.name === "name")!;
    expect(methodCallSnippet(method)).toBe("name()");
  });

  it("offers the fields too", () => {
    const completions = localMemberCompletions(members, { lineBeforeCursor: "        al", line: 17 });
    expect(completions.filter((entry) => entry.kind === "field").map((entry) => entry.label))
      .toEqual(["name", "alter", "ROLLEN"]);
  });

  it("offers only methods after this.", () => {
    const completions = localMemberCompletions(members, { lineBeforeCursor: "        this.", line: 17 });
    expect(completions.some((entry) => entry.kind === "field")).toBe(false);
    expect(completions.some((entry) => entry.kind === "method")).toBe(true);
  });

  it("says nothing after a dot on something else", () => {
    // What a variable offers depends on its type, and guessing would put
    // members of this class on an object that has none of them.
    expect(localMemberCompletions(members, { lineBeforeCursor: "        liste.", line: 17 })).toEqual([]);
    expect(localMemberCompletions(members, { lineBeforeCursor: "        System.out.", line: 17 })).toEqual([]);
  });

  it("says nothing after new, where a type belongs and not a member", () => {
    expect(localMemberCompletions(members, { lineBeforeCursor: "        var a = new ", line: 17 })).toEqual([]);
  });

  it("does not offer the method whose own signature is being written", () => {
    const onItsOwnLine = members.methods.find((entry) => entry.name === "name")!.line;
    const completions = localMemberCompletions(members, { lineBeforeCursor: "    public String na", line: onItsOwnLine });
    expect(completions.map((entry) => entry.label)).not.toContain("name()");
  });
});

/**
 * Static and instance, kept apart.
 *
 * In a static method there is no instance, so an instance member cannot be
 * reached. Offering one proposes a line that does not compile, and the error
 * lands on the word that was just accepted. `main` is the method this happens
 * in most, which is to say the first one anybody writes.
 */
describe("what is reachable from where the caret is", () => {
  const source = [
    "public class Server {",
    "    private int spieler;",
    "    private static int gesamt;",
    "",
    "    public int online() {",
    "        return spieler;",
    "    }",
    "",
    "    public static int alle() {",
    "        return gesamt;",
    "    }",
    "",
    "    public static void main(String[] args) {",
    "        ",
    "    }",
    "",
    "    public void lauf() {",
    "        ",
    "    }",
    "}",
  ].join("\n");
  const members = parseJavaMembers(source);
  const namesAt = (line: number, lineBeforeCursor = "        ") =>
    localMemberCompletions(members, { lineBeforeCursor, line })
      .map((item) => item.label.replace(/\(.*$/, ""));

  it("knows which method the caret is in", () => {
    expect(enclosingMethodAt(members, 6)?.name).toBe("online");
    expect(enclosingMethodAt(members, 14)?.name).toBe("main");
    expect(enclosingMethodAt(members, 1)).toBeNull();
  });

  it("offers only static members inside a static method", () => {
    const names = namesAt(14);
    expect(names).toContain("alle");
    expect(names).toContain("gesamt");
    expect(names).not.toContain("online");
    expect(names).not.toContain("spieler");
  });

  it("offers both inside an instance method", () => {
    // Java lets an instance method call a static one by its bare name.
    const names = namesAt(18);
    expect(names).toContain("online");
    expect(names).toContain("alle");
    expect(names).toContain("spieler");
  });

  it("offers nothing after this in a static method, because there is none", () => {
    expect(namesAt(14, "        this.")).toEqual([]);
    expect(namesAt(14, "        super.")).toEqual([]);
  });

  it("still offers members after this in an instance method", () => {
    expect(namesAt(18, "        this.")).toContain("online");
  });
});

describe("hasOpenTernary", () => {
  it("detects open and closed ternary operators", () => {
    expect(hasOpenTernary('LeafCloud.get().players().get("").get().isBedrock() ? ""')).toBe(true);
    expect(hasOpenTernary('LeafCloud.get().players().get("").get().isBedrock() ? "" : ""')).toBe(false);
    expect(hasOpenTernary('flag ? (a ? 1 : 2)')).toBe(true);
    expect(hasOpenTernary('flag ? (a ? 1 : 2) : 3')).toBe(false);
    expect(hasOpenTernary('List<?> list = null')).toBe(false);
  });
});

describe("memberAccessReceiver on chained invocations", () => {
  it("extracts receiver from chained calls", () => {
    expect(memberAccessReceiver('LeafCloud.get().players().get("").get().isBedrock().')).toBe("isBedrock");
    expect(memberAccessReceiver('LeafCloud.get().players().')).toBe("players");
    expect(memberAccessReceiver('player.')).toBe("player");
    expect(memberAccessReceiver('1.')).toBeNull();
  });
});
