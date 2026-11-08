import { describe, expect, it } from "vitest";
import {
  declaredTypeOf,
  enclosingReturnType,
  expectedTypeAt,
  functionalResultType,
  insideLambdaBody,
  normalizeType,
  typeAffinity,
} from "../src/language/expected-type";
import { parseJavaMembers } from "../src/language/java-completion";
import { completionScore, dedupeAndRankCompletions } from "../src/language/completion-controller";

const at = (source: string, over: { members?: unknown } = {}) => expectedTypeAt({
  textBeforeCursor: source,
  line: source.split("\n").length,
  members: (over.members as never) ?? parseJavaMembers(source),
});

/**
 * The reading that was never made.
 *
 * "return" used to be handed on as though it were a type name. The ranking
 * tokenised the word, threw it away as a keyword, matched nothing, and
 * penalised the whole list equally — so the one place where the expected type
 * is most obvious was the one place it was never worked out.
 */
describe("what a return statement expects", () => {
  const file = [
    "class Server {",
    "    private final Map<String, Player> players = new HashMap<>();",
    "",
    "    public List<Player> online() {",
    "        return ",
  ].join("\n");

  it("answers the method's own return type", () => {
    expect(at(file)).toMatchObject({ type: "List<Player>", source: "return" });
  });

  it("answers nothing for a method that returns void", () => {
    const voidMethod = ["class A {", "    void run() {", "        return "].join("\n");
    expect(at(voidMethod)).toBeNull();
  });

  it("answers nothing rather than the wrong method's type", () => {
    // A method declared after the caret cannot contain it.
    const members = parseJavaMembers([
      "class A {",
      "    void first() {",
      "    }",
      "    String second() {",
      "        return x;",
      "    }",
      "}",
    ].join("\n"));
    expect(enclosingReturnType({ textBeforeCursor: "", line: 2, members })).toBe("void");
    expect(enclosingReturnType({ textBeforeCursor: "", line: 5, members })).toBe("String");
  });

  it("says nothing inside a constructor, which returns nothing to say", () => {
    const members = parseJavaMembers(["class A {", "    A(int x) {", "    }", "}"].join("\n"));
    expect(enclosingReturnType({ textBeforeCursor: "", line: 2, members })).toBe("");
  });
});

describe("what a declaration expects", () => {
  it("reads the declared type, generics and all", () => {
    expect(at("class A { void f() { Map<String, List<Player>> byName = ")).toMatchObject({
      type: "Map<String, List<Player>>",
      source: "declaration",
      confidence: 0.95,
    });
  });

  it("says nothing for var, which is the point of var", () => {
    expect(at("class A { void f() { var value = ")).toBeNull();
  });

  it("reads an array type", () => {
    expect(at("class A { void f() { String[] names = ")?.type).toBe("String[]");
  });
});

describe("what an assignment to something that exists expects", () => {
  it("finds where the variable was declared", () => {
    const source = [
      "class A {",
      "    void f() {",
      "        List<String> names;",
      "        names = ",
    ].join("\n");
    expect(at(source)).toMatchObject({ type: "List<String>", source: "assignment" });
  });

  it("falls back to the file's own fields", () => {
    const source = [
      "class A {",
      "    private Duration timeout;",
      "    void f() {",
      "        timeout = ",
    ].join("\n");
    expect(at(source)).toMatchObject({ type: "Duration", source: "assignment" });
  });

  it("takes the nearest declaration when a name was declared twice", () => {
    const source = [
      "class A {",
      "    void f() {",
      "        int value = 1;",
      "    }",
      "    void g() {",
      "        String value;",
      "        value = ",
    ].join("\n");
    expect(at(source)?.type).toBe("String");
  });

  it("says nothing about a name it never saw declared", () => {
    expect(at("class A { void f() { unknownThing = ")).toBeNull();
  });
});

/**
 * The construct the caret is actually in.
 *
 * `call(other(x, ` is an argument of `other`, not of `call`, and the old
 * single-line regular expression could not tell the difference.
 */
describe("finding the innermost construct", () => {
  it("knows a condition wants a boolean", () => {
    expect(at("class A { void f() { if (")).toMatchObject({ type: "boolean", source: "condition" });
    expect(at("class A { void f() { while (!")?.type).toBe("boolean");
    expect(at("class A { void f() { if (a && ")?.type).toBe("boolean");
  });

  it("leaves an argument list to the language server", () => {
    // Signature help knows the overload and the position; guessing here would
    // be a worse answer competing with a better one.
    expect(at("class A { void f() { compute(")).toBeNull();
    expect(at("class A { void f() { call(other(x, ")).toBeNull();
  });

  it("is not fooled by a declaration outside the brackets", () => {
    // The declaration is real, but the caret is inside a call inside it.
    expect(at("class A { void f() { List<String> names = compute(")).toBeNull();
  });

  it("reads a cast", () => {
    expect(at("class A { void f() { doWork((Player) ")).toMatchObject({ type: "Player", source: "cast" });
    expect(at("class A { void f() { int n = (int) ")).toMatchObject({ type: "int", source: "cast" });
  });

  it("does not read a cast where there is none", () => {
    // Every one of these ends in a bracket and a space, and none of them is a
    // cast. Reading them as one would make the whole file expect nonsense.
    expect(at("class A { void f() { if (ready) ")?.source).not.toBe("cast");
    expect(at("class A { void f() { if (Player) ")?.source).not.toBe("cast");
    expect(at("class A { void f() { compute(x) ")?.source).not.toBe("cast");
    // Screaming caps is a constant being passed, not a type being cast to.
    expect(at("class A { void f() { configure(TIMEOUT) ")?.source).not.toBe("cast");
    expect(at("class A { void f() { for (Player p : all) ")?.source).not.toBe("cast");
  });

  it("knows an index wants a number", () => {
    expect(at("class A { void f() { names[")?.type).toBe("int");
  });

  it("knows an enhanced for wants something to iterate over", () => {
    expect(at("class A { void f() { for (Player player : ")).toMatchObject({
      type: "Iterable<Player>",
      source: "iteration",
    });
    // With var there is nothing to say about the element type.
    expect(at("class A { void f() { for (var player : ")).toBeNull();
  });

  it("knows a throw wants a throwable", () => {
    expect(at("class A { void f() { throw ")).toMatchObject({ type: "Throwable", source: "throw" });
  });

  it("is not confused by a bracket inside a string", () => {
    expect(at('class A { void f() { String s = "if (" + ')?.source).toBe("declaration");
  });

  it("says nothing where nothing is expected", () => {
    expect(at("class A { void f() { ")).toBeNull();
    expect(at("")).toBeNull();
  });
});

describe("reading a variable's declared type", () => {
  const context = (source: string) => ({
    textBeforeCursor: source,
    line: source.split("\n").length,
    members: parseJavaMembers(source),
  });

  it("finds a parameter as readily as a local", () => {
    expect(declaredTypeOf("player", context("void f(Player player) { "))).toBe("Player");
  });

  it("finds one declared in a for header", () => {
    expect(declaredTypeOf("index", context("void f() { for (int index = 0; "))).toBe("int");
  });

  it("answers nothing for a name it never saw", () => {
    expect(declaredTypeOf("nowhere", context("void f() { "))).toBe("");
    expect(declaredTypeOf("", context("void f() { "))).toBe("");
  });
});

/**
 * How well a candidate fits.
 *
 * Deliberately generous about not knowing: an item whose type cannot be read
 * scores 0 and keeps the order the language server gave it, because pushing an
 * unreadable item down is how a correct answer disappears.
 */
describe("weighing a candidate against what is expected", () => {
  it("rates the same type highest", () => {
    expect(typeAffinity("List<String>", "List<String>")).toBe(1);
    expect(typeAffinity("java.util.List<String>", "List<String>")).toBe(1);
  });

  it("separates the same type with different arguments from an unrelated one", () => {
    const sameArguments = typeAffinity("List<String>", "List<String>");
    const otherArguments = typeAffinity("List<String>", "List<Integer>");
    const unrelated = typeAffinity("List<String>", "Duration");
    expect(sameArguments).toBeGreaterThan(otherArguments);
    expect(otherArguments).toBeGreaterThan(unrelated);
  });

  it("treats a wildcard as fitting", () => {
    expect(typeAffinity("List<?>", "List<String>")).toBeGreaterThan(0.5);
  });

  it("knows a boxed type is the primitive", () => {
    expect(typeAffinity("int", "Integer")).toBeGreaterThan(0.8);
    expect(typeAffinity("Integer", "int")).toBeGreaterThan(0.8);
  });

  it("knows the few supertypes worth knowing", () => {
    expect(typeAffinity("List<String>", "ArrayList<String>")).toBeGreaterThan(0);
    expect(typeAffinity("Iterable", "HashSet")).toBeGreaterThan(0);
    expect(typeAffinity("CharSequence", "String")).toBeGreaterThan(0);
  });

  it("marks a primitive against a reference type as wrong", () => {
    expect(typeAffinity("int", "String")).toBeLessThan(0);
    expect(typeAffinity("boolean", "Player")).toBeLessThan(0);
  });

  it("says nothing when it cannot read one of them", () => {
    // Not knowing must not push a correct answer down the list.
    expect(typeAffinity("List<String>", "")).toBe(0);
    expect(typeAffinity("", "String")).toBe(0);
  });

  it("compares names the way Java resolves them", () => {
    expect(normalizeType("java.util.Map<java.lang.String, Player>")).toBe("map<string,player>");
    expect(normalizeType("  int [ ] ")).toBe("int[]");
    expect(normalizeType("")).toBe("");
  });
});

/**
 * The ranking that follows from the reading.
 *
 * The old rule had two settings: a type token matched, or it did not and every
 * item was penalised by a flat amount. At a return statement the expected type
 * was the word "return", which tokenised to nothing, so every item took the
 * penalty equally — and an item whose own type could not be read was pushed
 * down for not being readable, which is how a correct answer disappears.
 */
describe("ranking against what is expected", () => {
  const score = (item: Record<string, unknown>, expected: unknown) =>
    completionScore({ label: "x", source: "jdt", ...item } as never, "", "smart", expected as never);

  it("prefers the type that is expected", () => {
    const expected = { type: "List<Player>", source: "return" as const, confidence: 0.9 };
    const fits = score({ detail: "List<Player>" }, expected);
    const does_not = score({ detail: "Duration" }, expected);
    expect(fits).toBeLessThan(does_not);
  });

  it("leaves an item whose type cannot be read where the server put it", () => {
    const expected = { type: "List<Player>", source: "return" as const, confidence: 0.9 };
    expect(score({ detail: "" }, expected)).toBe(score({ detail: "" }, ""));
  });

  it("trusts a reading less when it says it is less sure", () => {
    const sure = { type: "String", source: "declaration" as const, confidence: 0.95 };
    const guessed = { type: "String", source: "iteration" as const, confidence: 0.5 };
    const item = { detail: "String" };
    // Both help, but the guess moves the item less far.
    expect(score(item, sure)).toBeLessThan(score(item, guessed));
    expect(score(item, guessed)).toBeLessThan(score(item, ""));
  });

  it("takes a plain type name from a caller that has only that", () => {
    expect(score({ detail: "String" }, "String")).toBeLessThan(score({ detail: "Duration" }, "String"));
  });

  it("does nothing at all unless the completion was asked to be smart", () => {
    const expected = { type: "String", source: "declaration" as const, confidence: 1 };
    const basic = completionScore({ label: "x", source: "jdt", detail: "String" } as never, "", "basic", expected);
    const plain = completionScore({ label: "x", source: "jdt", detail: "String" } as never, "", "basic", "");
    expect(basic).toBe(plain);
  });
});

/**
 * The whole path, from a buffer to an ordered list.
 */
describe("a return statement, end to end", () => {
  it("puts the method's own return type first", () => {
    const source = [
      "class Server {",
      "    public List<Player> online() {",
      "        return ",
    ].join("\n");
    const expected = expectedTypeAt({
      textBeforeCursor: source,
      line: 3,
      members: parseJavaMembers(source),
    });
    const ranked = dedupeAndRankCompletions([
      { label: "timeout", detail: "Duration", source: "jdt", sortText: "0001" },
      { label: "names", detail: "List<String>", source: "jdt", sortText: "0002" },
      { label: "players", detail: "List<Player>", source: "jdt", sortText: "0003" },
    ] as never, "", "smart", expected);
    expect(ranked.map((item) => item.label)[0]).toBe("players");
  });
});

/**
 * The body of a lambda.
 *
 * At `spieler.stream().filter(s -> s.` the call wants a Predicate and
 * signature help says so — but what is being written at the caret is the
 * predicate's result, a boolean. Ranking against the interface pushes every
 * boolean-returning member down at exactly the moment one is wanted.
 */
describe("recognising a lambda body", () => {
  it("knows the caret is writing one", () => {
    expect(insideLambdaBody("    spieler.stream().filter(s -> s.")).toBe(true);
    expect(insideLambdaBody("    liste.forEach(eintrag -> ")).toBe(true);
    expect(insideLambdaBody("    map.computeIfAbsent(schluessel, k -> new ")).toBe(true);
  });

  it("knows when it is not", () => {
    expect(insideLambdaBody("    spieler.stream().filter(")).toBe(false);
    expect(insideLambdaBody("    compute(a, b")).toBe(false);
    expect(insideLambdaBody("    int x = 1")).toBe(false);
  });

  it("is not fooled by an arrow that belongs to a switch", () => {
    // That arrow lives inside braces, which end the scan before it.
    expect(insideLambdaBody("    switch (wert) {\n        case 1 -> ")).toBe(false);
  });

  it("is not fooled by an arrow inside a string", () => {
    expect(insideLambdaBody('    log(" -> ", ')).toBe(false);
  });
});

describe("what a functional interface gives back", () => {
  it("reads the predicates and the comparators", () => {
    expect(functionalResultType("Predicate<? super Spieler>")).toBe("boolean");
    expect(functionalResultType("java.util.function.BiPredicate<A,B>")).toBe("boolean");
    expect(functionalResultType("Comparator<Spieler>")).toBe("int");
  });

  it("reads the result of a function as its last type argument", () => {
    expect(functionalResultType("Function<Spieler, String>")).toBe("String");
    expect(functionalResultType("BiFunction<A, B, List<C>>")).toBe("List<C>");
    expect(functionalResultType("Supplier<Spieler>")).toBe("Spieler");
    expect(functionalResultType("UnaryOperator<String>")).toBe("String");
  });

  it("expects nothing where the interface returns nothing", () => {
    // A Consumer gives nothing back, and an interface this does not know is
    // better left unranked than guessed at.
    expect(functionalResultType("Consumer<Spieler>")).toBe("");
    expect(functionalResultType("Runnable")).toBe("");
    expect(functionalResultType("MeinEigenesInterface<X>")).toBe("");
    expect(functionalResultType("")).toBe("");
  });
});
