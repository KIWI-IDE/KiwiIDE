/** Languages Kiwi can edit, independent of an installed compiler or server. */
export interface LanguageSnippet {
  label: string;
  insertText: string;
  detail: string;
}

export interface SourceLanguage {
  id: string;
  name: string;
  extensions: readonly string[];
  /** Java has its existing JDT integration; web languages use Monaco workers. */
  externalServer: boolean;
  keywords: readonly string[];
  builtins: readonly string[];
  snippets: readonly LanguageSnippet[];
}

const words = (value: string) => value.split(/\s+/).filter(Boolean);
const snippet = (label: string, insertText: string, detail: string): LanguageSnippet => ({ label, insertText, detail });

export const sourceLanguages: readonly SourceLanguage[] = [
  { id: "java", name: "Java", extensions: ["java"], externalServer: false, keywords: [], builtins: [], snippets: [] },
  {
    id: "kotlin", name: "Kotlin", extensions: ["kt", "kts"], externalServer: true,
    keywords: words("as break class continue do else false for fun if in interface is null object package return super this throw true try typealias typeof val var when while by catch constructor delegate dynamic field file finally get import init param property receiver set setparam where actual abstract annotation companion const crossinline data enum expect external final infix inline inner internal lateinit noinline open operator out override private protected public reified sealed suspend tailrec vararg"),
    builtins: words("println print readln readLine listOf mutableListOf mapOf mutableMapOf setOf mutableSetOf arrayOf emptyList emptyMap require check error TODO run let also apply with repeat lazy sequenceOf String Int Long Double Float Boolean Unit Any Nothing Pair Triple Result"),
    snippets: [
      snippet("fun", "fun ${1:name}(${2:args}): ${3:Unit} {\n\t$0\n}", "Function"),
      snippet("main", "fun main() {\n\t${0:println(\"Hello, world!\")}\n}", "Program entry point"),
      snippet("data class", "data class ${1:Name}(val ${2:value}: ${3:String})", "Data class"),
      snippet("for", "for (${1:item} in ${2:items}) {\n\t$0\n}", "For each loop"),
      snippet("when", "when (${1:value}) {\n\t${2:condition} -> ${3:result}\n\telse -> $0\n}", "When expression"),
    ],
  },
  {
    id: "python", name: "Python", extensions: ["py", "pyw", "pyi"], externalServer: true,
    keywords: words("False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case"),
    builtins: words("print len range enumerate zip sorted reversed list dict set tuple str int float bool bytes object type isinstance issubclass super property staticmethod classmethod open input sum min max abs round any all map filter iter next getattr setattr hasattr Exception ValueError TypeError RuntimeError NotImplementedError"),
    snippets: [
      snippet("def", "def ${1:name}(${2:args}):\n\t$0", "Function"),
      snippet("class", "class ${1:Name}:\n\tdef __init__(self${2:, args}):\n\t\t$0", "Class with initializer"),
      snippet("main", "if __name__ == \"__main__\":\n\t$0", "Program entry point"),
      snippet("for", "for ${1:item} in ${2:items}:\n\t$0", "For each loop"),
      snippet("try", "try:\n\t${1:pass}\nexcept ${2:Exception} as ${3:error}:\n\t$0", "Exception handling"),
      snippet("with", "with open(${1:path}, ${2:\"r\"}) as ${3:file}:\n\t$0", "Context manager"),
    ],
  },
  {
    id: "rust", name: "Rust", extensions: ["rs"], externalServer: true,
    keywords: words("as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while abstract become box do final macro override priv typeof unsized virtual yield try"),
    builtins: words("println! print! eprintln! format! vec! panic! assert! assert_eq! assert_ne! dbg! todo! unimplemented! include_str! String Vec Option Some None Result Ok Err Box Rc Arc HashMap HashSet Iterator Into From Default Debug Clone Copy Send Sync Sized"),
    snippets: [
      snippet("fn", "fn ${1:name}(${2:args})${3: -> ()} {\n\t$0\n}", "Function"),
      snippet("main", "fn main() {\n\t${0:println!(\"Hello, world!\");}\n}", "Program entry point"),
      snippet("struct", "struct ${1:Name} {\n\t${2:value}: ${3:String},\n}", "Structure"),
      snippet("impl", "impl ${1:Name} {\n\t$0\n}", "Implementation"),
      snippet("match", "match ${1:value} {\n\t${2:pattern} => ${3:result},\n\t_ => $0,\n}", "Pattern matching"),
      snippet("test", "#[test]\nfn ${1:test_name}() {\n\t${0:assert_eq!(1, 1);}\n}", "Unit test"),
    ],
  },
  {
    id: "php", name: "PHP", extensions: ["php", "phtml", "php3", "php4", "php5", "php7", "php8", "phps"], externalServer: true,
    keywords: words("abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile enum eval exit extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while xor yield true false null self parent"),
    builtins: words("strlen count array_map array_filter array_reduce array_merge array_keys array_values in_array array_key_exists explode implode trim substr str_contains str_starts_with str_ends_with sprintf printf json_encode json_decode file_get_contents file_put_contents fopen fclose htmlspecialchars filter_input filter_var preg_match preg_replace date time header session_start PDO Exception Throwable DateTime"),
    snippets: [
      snippet("php", "<?php\n\ndeclare(strict_types=1);\n\n$0", "PHP file"),
      snippet("function", "function ${1:name}(${2:args}): ${3:void}\n{\n\t$0\n}", "Function"),
      snippet("class", "class ${1:Name}\n{\n\t$0\n}", "Class"),
      snippet("foreach", "foreach (${1:\$items} as ${2:\$item}) {\n\t$0\n}", "For each loop"),
      snippet("try", "try {\n\t${1}\n} catch (${2:\\Throwable} ${3:\$error}) {\n\t$0\n}", "Exception handling"),
    ],
  },
  {
    id: "lua", name: "Lua", extensions: ["lua"], externalServer: true,
    keywords: words("and break do else elseif end false for function goto if in local nil not or repeat return then true until while"),
    builtins: words("assert collectgarbage dofile error getmetatable ipairs load loadfile next pairs pcall print rawequal rawget rawlen rawset require select setmetatable tonumber tostring type warn xpcall coroutine debug io math os package string table utf8"),
    snippets: [
      snippet("function", "local function ${1:name}(${2:args})\n\t$0\nend", "Local function"),
      snippet("for", "for ${1:key}, ${2:value} in pairs(${3:items}) do\n\t$0\nend", "Table iteration"),
      snippet("if", "if ${1:condition} then\n\t$0\nend", "Conditional"),
      snippet("while", "while ${1:condition} do\n\t$0\nend", "While loop"),
    ],
  },
  {
    id: "go", name: "Go", extensions: ["go"], externalServer: true,
    keywords: words("break default func interface select case defer go map struct chan else goto package switch const fallthrough if range type continue for import return var"),
    builtins: words("append cap clear close complex copy delete imag len make max min new panic print println real recover bool byte complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint uint8 uint16 uint32 uint64 uintptr any comparable true false nil iota"),
    snippets: [
      snippet("func", "func ${1:name}(${2:args})${3: error} {\n\t$0\n}", "Function"),
      snippet("main", "package main\n\nimport \"fmt\"\n\nfunc main() {\n\tfmt.Println(${0:\"Hello, world!\"})\n}", "Program entry point"),
      snippet("iferr", "if err != nil {\n\treturn ${0:err}\n}", "Error handling"),
      snippet("for", "for ${1:key}, ${2:value} := range ${3:items} {\n\t$0\n}", "Range loop"),
      snippet("struct", "type ${1:Name} struct {\n\t${2:Value} ${3:string}\n}", "Structure"),
    ],
  },
  {
    id: "c", name: "C", extensions: ["c", "h"], externalServer: true,
    keywords: words("alignas alignof auto bool break case char const constexpr continue default do double else enum extern false float for goto if inline int long nullptr register restrict return short signed sizeof static static_assert struct switch thread_local true typedef typeof typeof_unqual union unsigned void volatile while _Alignas _Alignof _Atomic _Bool _Complex _Generic _Imaginary _Noreturn _Static_assert _Thread_local"),
    builtins: words("printf fprintf sprintf snprintf scanf fgets puts fputs getchar putchar fopen fclose fread fwrite fflush malloc calloc realloc free memcpy memmove memset memcmp strlen strcmp strcpy strncpy strcat strchr strstr qsort bsearch exit abort size_t ptrdiff_t FILE NULL EOF stdin stdout stderr"),
    snippets: [
      snippet("main", "#include <stdio.h>\n\nint main(void) {\n\t${1:puts(\"Hello, world!\");}\n\treturn 0;\n}", "Program entry point"),
      snippet("for", "for (${1:int i = 0}; ${2:i < count}; ${3:++i}) {\n\t$0\n}", "For loop"),
      snippet("struct", "typedef struct ${1:Name} {\n\t${2:int value;}\n} ${1:Name};", "Structure"),
      snippet("include", "#include <${1:stdio.h}>", "System header"),
    ],
  },
  {
    id: "cpp", name: "C++", extensions: ["cpp", "cc", "cxx", "c++", "hpp", "hh", "hxx", "h++", "ipp", "tpp", "ixx", "cppm"], externalServer: true,
    keywords: words("alignas alignof and and_eq asm auto bitand bitor bool break case catch char char8_t char16_t char32_t class co_await co_return co_yield concept const consteval constexpr constinit const_cast continue decltype default delete do double dynamic_cast else enum explicit export extern false float for friend goto if inline int long mutable namespace new noexcept not not_eq nullptr operator or or_eq private protected public register reinterpret_cast requires return short signed sizeof static static_assert static_cast struct switch template this thread_local throw true try typedef typeid typename union unsigned using virtual void volatile wchar_t while xor xor_eq"),
    builtins: words("std size_t string string_view vector array map unordered_map set unordered_set unique_ptr shared_ptr weak_ptr make_unique make_shared optional variant tuple pair move forward begin end sort find cout cerr cin endl printf nullptr"),
    snippets: [
      snippet("main", "#include <iostream>\n\nint main() {\n\t${1:std::cout << \"Hello, world!\\n\";}\n\treturn 0;\n}", "Program entry point"),
      snippet("class", "class ${1:Name} {\npublic:\n\t${1:Name}() = default;\n\t$0\n};", "Class"),
      snippet("for", "for (const auto& ${1:item} : ${2:items}) {\n\t$0\n}", "Range loop"),
      snippet("template", "template <typename ${1:T}>\n${2:void} ${3:name}(${1:T} ${4:value}) {\n\t$0\n}", "Function template"),
    ],
  },
  {
    id: "csharp", name: "C#", extensions: ["cs", "csx"], externalServer: true,
    keywords: words("abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly record ref required return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while async await dynamic get init let nameof not notnull partial remove set unmanaged value var when where with yield"),
    builtins: words("Console Math Array String List Dictionary HashSet IEnumerable IEnumerator IDisposable Task ValueTask CancellationToken DateTime TimeSpan Guid Exception ArgumentException InvalidOperationException Nullable Span Memory Enumerable"),
    snippets: [
      snippet("class", "public class ${1:Name}\n{\n\t$0\n}", "Class"),
      snippet("main", "using System;\n\nConsole.WriteLine(${0:\"Hello, world!\"});", "Program entry point"),
      snippet("prop", "public ${1:string} ${2:Name} { get; set; }", "Property"),
      snippet("foreach", "foreach (var ${1:item} in ${2:items})\n{\n\t$0\n}", "For each loop"),
      snippet("async", "public async Task${1:<T>} ${2:Name}Async(${3:args})\n{\n\t$0\n}", "Asynchronous method"),
    ],
  },
  {
    id: "objective-c", name: "Objective-C", extensions: ["m"], externalServer: true,
    keywords: words("@interface @implementation @end @property @synthesize @dynamic @class @protocol @selector @encode @autoreleasepool @try @catch @finally @throw @synchronized @optional @required @public @private @protected @package id self super nil Nil YES NO BOOL NSInteger NSUInteger NSString NSObject alloc init retain release copy strong weak nonatomic nullable nonnull return if else for while switch case break continue typedef struct enum const static void int char float double"),
    builtins: words("NSLog NSString NSArray NSMutableArray NSDictionary NSMutableDictionary NSNumber NSObject NSError NSData NSDate NSURL NSSet NSInteger NSUInteger dispatch_async dispatch_get_main_queue"),
    snippets: [
      snippet("interface", "@interface ${1:Name} : ${2:NSObject}\n$0\n@end", "Class interface"),
      snippet("implementation", "@implementation ${1:Name}\n$0\n@end", "Class implementation"),
      snippet("method", "- (${1:void})${2:name}\n{\n\t$0\n}", "Instance method"),
      snippet("main", "#import <Foundation/Foundation.h>\n\nint main(int argc, const char *argv[]) {\n\t@autoreleasepool {\n\t\t${0:NSLog(@\"Hello, world!\");}\n\t}\n\treturn 0;\n}", "Program entry point"),
    ],
  },
  { id: "objective-cpp", name: "Objective-C++", extensions: ["mm"], externalServer: true, keywords: [], builtins: [], snippets: [] },
  {
    id: "javascript", name: "JavaScript", extensions: ["js", "jsx", "mjs", "cjs"], externalServer: false,
    keywords: words("async await break case catch class const continue debugger default delete do else export extends false finally for function if import in instanceof let new null return super switch this throw true try typeof var void while with yield of as from"),
    builtins: words("console process require module exports window document global globalThis Buffer setTimeout setInterval clearTimeout clearInterval Promise Array Object String Number Boolean Math JSON Date RegExp Map Set WeakMap WeakSet Symbol Error TypeError RangeError SyntaxError fetch URL URLSearchParams parseInt parseFloat isNaN isFinite"),
    snippets: [
      snippet("function", "function ${1:name}(${2:args}) {\n\t$0\n}", "Function"),
      snippet("arrow", "const ${1:name} = (${2:args}) => {\n\t$0\n};", "Arrow function"),
      snippet("async", "async function ${1:name}(${2:args}) {\n\t$0\n}", "Async function"),
      snippet("clg", "console.log($0);", "Console log"),
      snippet("for", "for (const ${1:item} of ${2:items}) {\n\t$0\n}", "For of loop"),
      snippet("try", "try {\n\t$0\n} catch (${1:error}) {\n\tconsole.error(${1:error});\n}", "Try catch"),
      snippet("express", "import express from \"express\";\n\nconst app = express();\nconst port = process.env.PORT || 3000;\n\napp.use(express.json());\n\napp.get(\"/\", (req, res) => {\n\tres.json({ status: \"ok\" });\n});\n\napp.listen(port, () => console.log(`Server on ${port}`));", "Express server starter"),
    ],
  },
  {
    id: "typescript", name: "TypeScript", extensions: ["ts", "tsx", "mts", "cts"], externalServer: false,
    keywords: words("async await break case catch class const continue debugger default delete do else export extends false finally for function if import in instanceof let new null return super switch this throw true try typeof var void while with yield of as from type interface enum namespace declare readonly keyof infer is satisfies abstract override private protected public static implements any unknown never void"),
    builtins: words("console process require module exports window document global globalThis Buffer setTimeout setInterval clearTimeout clearInterval Promise Array Object String Number Boolean Math JSON Date RegExp Map Set WeakMap WeakSet Symbol Error TypeError RangeError SyntaxError fetch URL URLSearchParams parseInt parseFloat isNaN isFinite Record Partial Required Readonly Pick Omit Exclude Extract NonNullable ReturnType Parameters"),
    snippets: [
      snippet("interface", "interface ${1:Name} {\n\t${2:property}: ${3:string};\n}", "TypeScript interface"),
      snippet("type", "type ${1:Name} = ${2:string};", "TypeScript type alias"),
      snippet("function", "function ${1:name}(${2:param}: ${3:string}): ${4:void} {\n\t$0\n}", "Typed function"),
      snippet("arrow", "const ${1:name} = (${2:param}: ${3:string}): ${4:void} => {\n\t$0\n};", "Typed arrow function"),
      snippet("react-fc", "import React from \"react\";\n\ninterface ${1:Name}Props {\n\ttitle?: string;\n}\n\nexport const ${1:Name}: React.FC<${1:Name}Props> = ({ title = \"${1:Name}\" }) => {\n\treturn (\n\t\t<div>\n\t\t\t<h2>{title}</h2>\n\t\t</div>\n\t);\n};", "React functional component"),
      snippet("async", "async function ${1:name}(${2:args}): Promise<${3:void}> {\n\t$0\n}", "Async typed function"),
    ],
  },
  { id: "html", name: "HTML", extensions: ["html", "htm", "xhtml"], externalServer: false, keywords: [], builtins: [], snippets: [] },
  { id: "css", name: "CSS", extensions: ["css"], externalServer: false, keywords: [], builtins: [], snippets: [] },
  { id: "scss", name: "SCSS", extensions: ["scss"], externalServer: false, keywords: [], builtins: [], snippets: [] },
  { id: "less", name: "Less", extensions: ["less"], externalServer: false, keywords: [], builtins: [], snippets: [] },
  { id: "json", name: "JSON", extensions: ["json", "jsonc"], externalServer: false, keywords: [], builtins: [], snippets: [] },
  {
    id: "dart", name: "Dart", extensions: ["dart"], externalServer: true,
    keywords: words("abstract as assert async await base break case catch class const continue covariant default deferred do dynamic else enum export extends extension external factory false final finally for function get hide if implements import in interface is late library mixin new null of on operator part required rethrow return sealed set show static super switch sync this throw true try typedef var void when while with yield"),
    builtins: words("print int double num bool String List Map Set Iterable Future Stream Duration DateTime Uri Object Symbol Runes Comparable Pattern RegExp Exception Error"),
    snippets: [
      snippet("main", "void main() {\n\t${0:print('Hello, world!');}\n}", "Program entry point"),
      snippet("class", "class ${1:Name} {\n\t${1:Name}();\n\t$0\n}", "Class definition"),
      snippet("func", "${1:void} ${2:name}(${3:args}) {\n\t$0\n}", "Function"),
    ],
  },
  {
    id: "zig", name: "Zig", extensions: ["zig", "zon"], externalServer: true,
    keywords: words("addrspace align allowzero and anyframe anytype asm async await break callconv catch comptime const continue defer discard do else enum errdefer error export extern fn for if inline noalias noinline nosuspend orelse or packed pub resume return struct suspend switch test threadlocal try union unreachable usingnamespace var volatile while"),
    builtins: words("@import @as @alignOf @sizeOf @TypeOf @compileError @compileLog @intCast @floatCast @ptrCast @truncate @memcpy @memset @panic @breakpoint @ptrFromInt @intFromPtr std stdout print writer Allocator ArrayList"),
    snippets: [
      snippet("main", "const std = @import(\"std\");\n\npub fn main() !void {\n\tconst stdout = std.io.getStdOut().writer();\n\ttry stdout.print(\"${0:Hello, world!}\\n\", .{});\n}", "Program entry point"),
      snippet("fn", "pub fn ${1:name}(${2:args}) ${3:!void} {\n\t$0\n}", "Function"),
      snippet("test", "test \"${1:test name}\" {\n\t${0:try std.testing.expect(true);}\n}", "Unit test"),
    ],
  },
  {
    id: "swift", name: "Swift", extensions: ["swift"], externalServer: true,
    keywords: words("associatedtype async await break case catch class continue default defer deinit do else enum extension fallthrough false fileprivate for func get guard if import in init inout internal is let macro muting nil operator open override precedencegroup private protocol public repeat rethrows return self Self set some static struct subscript super switch throw throws true try typealias var where while willSet didSet"),
    builtins: words("print String Int Double Float Bool Array Dictionary Set Optional Result Error Task MainActor Any AnyObject fatalError precondition min max zip sequence"),
    snippets: [
      snippet("func", "func ${1:name}(${2:params}) -> ${3:Void} {\n\t$0\n}", "Function"),
      snippet("struct", "struct ${1:Name} {\n\t$0\n}", "Struct"),
      snippet("class", "class ${1:Name} {\n\tinit() {\n\t\t$0\n\t}\n}", "Class"),
      snippet("guard", "guard let ${1:unwrapped} = ${2:optional} else {\n\treturn$0\n}", "Guard unwrapping"),
    ],
  },
  {
    id: "ruby", name: "Ruby", extensions: ["rb", "rake", "gemspec"], externalServer: true,
    keywords: words("alias and BEGIN begin break case class def defined? do else elsif END end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield __FILE__ __LINE__ __ENCODING__"),
    builtins: words("puts print p raise require require_relative attr_reader attr_writer attr_accessor include extend prepend lambda proc loop Integer Float String Array Hash Symbol Enumerable Comparable StandardError"),
    snippets: [
      snippet("def", "def ${1:name}(${2:args})\n\t$0\nend", "Method definition"),
      snippet("class", "class ${1:Name}\n\tdef initialize(${2:args})\n\t\t$0\n\tend\nend", "Class definition"),
      snippet("each", "${1:items}.each do |${2:item}|\n\t$0\nend", "Each loop"),
    ],
  },
  {
    id: "elixir", name: "Elixir", extensions: ["ex", "exs"], externalServer: true,
    keywords: words("after and case catch cond def defmodule defp defmacro defstruct do else end false fn for if import in nil not or quote raise receive require rescue super true try unless unquote unquote_splicing use when with yield"),
    builtins: words("IO puts inspect hd tl length is_list is_map is_binary is_atom is_integer is_float elem tuple_size to_string apply spawn send make_ref self Map Enum List String Task GenServer Agent"),
    snippets: [
      snippet("defmodule", "defmodule ${1:ModuleName} do\n\t$0\nend", "Module definition"),
      snippet("def", "def ${1:name}(${2:args}) do\n\t$0\nend", "Function definition"),
      snippet("fn", "fn ${1:args} -> $0 end", "Anonymous function"),
    ],
  },
  {
    id: "r", name: "R", extensions: ["r", "R", "Rmd"], externalServer: true,
    keywords: words("if else repeat while function for in next break TRUE FALSE NULL Inf NaN NA NA_integer_ NA_real_ NA_complex_ NA_character_"),
    builtins: words("c list data.frame matrix array vector print cat summary length dim nrow ncol names colnames rownames apply lapply sapply paste paste0 str head tail read.csv write.csv plot mean median sd var"),
    snippets: [
      snippet("func", "${1:name} <- function(${2:args}) {\n\t$0\n}", "Function definition"),
      snippet("df", "data.frame(\n\t${1:col1} = ${2:c()},\n\t$0\n)", "Data frame"),
      snippet("for", "for (${1:i} in ${2:1:n}) {\n\t$0\n}", "For loop"),
    ],
  },
  {
    id: "scala", name: "Scala", extensions: ["scala", "sc", "sbt"], externalServer: true,
    keywords: words("abstract case catch class def deriving do else enum export extends extension false final finally for forSome given if implicit import infix inline lazy match new null object opaque open override package private protected return sealed super then this throw trait transparent true try type val var while with yield"),
    builtins: words("println print require assert List Vector Seq Map Set Option Some None Either Left Right Future Try Success Failure String Int Long Double Float Boolean Any AnyVal AnyRef Unit Nothing Null"),
    snippets: [
      snippet("main", "@main def run(): Unit = {\n\t${0:println(\"Hello, world!\")}\n}", "Program entry point"),
      snippet("def", "def ${1:name}(${2:args}): ${3:Unit} = {\n\t$0\n}", "Method definition"),
      snippet("case class", "case class ${1:Name}(${2:field}: ${3:String})", "Case class"),
    ],
  },
  {
    id: "shell", name: "Shell", extensions: ["sh", "bash", "zsh"], externalServer: true,
    keywords: words("if then else elif fi case esac for select while until do done in function time declare typeset local readonly export unset shift trap return exit continue break eval exec"),
    builtins: words("echo printf read cd pwd test true false kill wait source alias unalias set umask"),
    snippets: [
      snippet("shebang", "#!/usr/bin/env bash\nset -euo pipefail\n\n$0", "Bash shebang header"),
      snippet("func", "${1:name}() {\n\t$0\n}", "Function definition"),
      snippet("if", "if [[ ${1:condition} ]]; then\n\t$0\nfi", "If statement"),
      snippet("for", "for ${1:item} in \"\${${2:items}[@]}\"; do\n\t$0\ndone", "For array loop"),
    ],
  },
  {
    id: "powershell", name: "PowerShell", extensions: ["ps1", "psm1", "psd1"], externalServer: true,
    keywords: words("begin break catch class clean continue data default do dynamicparam else elseif end enum exit filter finally for foreach from function if in inlinescript hidden param process return switch throw trap try until using virtual while workflow parallel sequence"),
    builtins: words("Write-Host Write-Output Write-Error Get-Content Set-Content Get-ChildItem Out-Null Select-Object Where-Object ForEach-Object Test-Path Join-Path Start-Process Stop-Process Measure-Object ConvertTo-Json ConvertFrom-Json"),
    snippets: [
      snippet("func", "function ${1:Verb-Noun} {\n\t[CmdletBinding()]\n\tparam(\n\t\t[Parameter(Mandatory)]\n\t\t[string]$${2:Name}\n\t)\n\t$0\n}", "Cmdlet function"),
      snippet("try", "try {\n\t$0\n} catch {\n\tWrite-Error $_.Exception.Message\n}", "Try catch block"),
      snippet("foreach", "foreach ($${1:item} in $${2:collection}) {\n\t$0\n}", "Foreach loop"),
    ],
  },
  {
    id: "perl", name: "Perl", extensions: ["pl", "pm", "t", "pod"], externalServer: true,
    keywords: words("my our state local sub package use require no if unless else elsif given when default while until for foreach do continue last next redo goto return my sub has with extends eval BEGIN UNITCHECK CHECK INIT END strict warnings"),
    builtins: words("print printf say sprintf length substr index rindex split join push pop shift unshift splice grep map sort reverse keys values each exists delete defined undef die warn open close opendir closedir readdir chdir chmod stat lstat chown unlink rename binmode tell seek"),
    snippets: [
      snippet("shebang", "#!/usr/bin/env perl\nuse strict;\nuse warnings;\nuse feature 'say';\n\n$0", "Perl shebang header"),
      snippet("sub", "sub ${1:name} {\n\tmy (${2:\\$self, \\$args}) = @_;\n\t$0\n}", "Subroutine"),
      snippet("package", "package ${1:PackageName};\n\nuse strict;\nuse warnings;\n\n$0\n\n1;", "Package module"),
    ],
  },
  {
    id: "gdscript", name: "GDScript", extensions: ["gd"], externalServer: true,
    keywords: words("if elif else for while match when break continue pass return class class_name extends is as self tool signal func static const enum var onready export setget breakpoint preload assert await void"),
    builtins: words("print print_debug print_rich printerr push_error push_warning randf randi randf_range randi_range sin cos tan abs round floor ceil min max clamp lerp str len range Color Vector2 Vector3 Vector4 Transform2D Transform3D Quaternion Basis AABB Rect2 Node Node2D Node3D CharacterBody2D CharacterBody3D RigidBody2D RigidBody3D Area2D Area3D Sprite2D Sprite3D Camera2D Camera3D"),
    snippets: [
      snippet("func", "func ${1:name}(${2:args}) -> ${3:void}:\n\t$0", "Function definition"),
      snippet("ready", "func _ready() -> void:\n\t$0", "Node ready lifecycle"),
      snippet("process", "func _process(delta: float) -> void:\n\t$0", "Frame process callback"),
      snippet("class", "class_name ${1:Name}\nextends ${2:Node}\n\n$0", "Class declaration"),
    ],
  },
  {
    id: "sql", name: "SQL", extensions: ["sql", "dsql"], externalServer: true,
    keywords: words("SELECT FROM WHERE INSERT INTO UPDATE DELETE CREATE TABLE DROP ALTER JOIN INNER LEFT RIGHT FULL OUTER ON GROUP BY HAVING ORDER BY ASC DESC LIMIT OFFSET UNION ALL AS AND OR NOT NULL IS DISTINCT CASE WHEN THEN ELSE END PRIMARY KEY FOREIGN KEY REFERENCES DEFAULT CONSTRAINT"),
    builtins: words("COUNT SUM AVG MIN MAX COALESCE NOW CURRENT_TIMESTAMP DATE SUBSTR UPPER LOWER TRIM LENGTH ROUND CAST CONVERT"),
    snippets: [
      snippet("select", "SELECT ${1:*} FROM ${2:table} WHERE ${3:condition};", "Select query"),
      snippet("create", "CREATE TABLE ${1:table_name} (\n\tid INTEGER PRIMARY KEY AUTOINCREMENT,\n\t${2:name} TEXT NOT NULL\n);", "Create table"),
      snippet("insert", "INSERT INTO ${1:table_name} (${2:columns}) VALUES (${3:values});", "Insert statement"),
    ],
  },
  {
    id: "terraform", name: "Terraform", extensions: ["tf", "tfvars", "hcl"], externalServer: true,
    keywords: words("terraform resource data variable output locals module provider count for_each lifecycle depends_on true false null string number bool list map set any"),
    builtins: words("merge concat tostring tonumber tobool tolist toset length lookup element file templatefile coalesce"),
    snippets: [
      snippet("resource", "resource \"${1:type}\" \"${2:name}\" {\n\t$0\n}", "Resource block"),
      snippet("variable", "variable \"${1:name}\" {\n\ttype        = ${2:string}\n\tdescription = \"${3}\"\n}", "Variable declaration"),
      snippet("output", "output \"${1:name}\" {\n\tvalue = ${2:expression}\n}", "Output definition"),
    ],
  },
  {
    id: "assembly", name: "Assembly", extensions: ["asm", "s"], externalServer: true,
    keywords: words("section global extern default rel mov lea add sub inc dec mul div xor and or not jmp je jne jz jnz jg jge jl jle call ret push pop cmp test nop db dw dd dq resb resw resd resq"),
    builtins: words("rax rbx rcx rdx rsi rdi rsp rbp r8 r9 r10 r11 r12 r13 r14 r15 eax ebx ecx edx al bl cl dl rip"),
    snippets: [
      snippet("main", "default rel\nglobal main\n\nsection .text\nmain:\n\txor eax, eax\n\tret\n", "Main entry point"),
      snippet("func", "${1:name}:\n\tpush rbp\n\tmov rbp, rsp\n\t$0\n\tpop rbp\n\tret\n", "Function routine"),
      snippet("loop", "mov rcx, ${1:10}\n.loop:\n\t$0\n\tdec rcx\n\tjnz .loop\n", "Loop block"),
    ],
  },
  {
    id: "autohotkey", name: "AutoHotkey", extensions: ["ahk"], externalServer: true,
    keywords: words("if else while loop for in try catch finally return break continue switch case default class static extends global local throw as is unset true false"),
    builtins: words("MsgBox TrayTip ToolTip SoundBeep Run Send Click MouseMove WinActivate WinWait WinExist Sleep StrLen SubStr InStr RegExMatch RegExReplace FileRead FileAppend Format DateAdd"),
    snippets: [
      snippet("hotkey", "${1:^!k}:: {\n\t$0\n}", "Hotkey definition"),
      snippet("msgbox", "MsgBox(\"${1:message}\", \"${2:title}\")", "Message box"),
      snippet("func", "${1:name}(${2:params}) {\n\t$0\n}", "Function definition"),
    ],
  },
  {
    id: "odin", name: "Odin", extensions: ["odin"], externalServer: true,
    keywords: words("package import proc struct enum union distinct dynamic bit_set bit_field using where when if else for in switch case do return defer fallthrough break continue asm cast transmute auto_cast size_of offset_of type_of typeid_of context"),
    builtins: words("fmt println print printf len cap make delete append new free copy clear min max clamp bool b8 b16 b32 b64 int i8 i16 i32 i64 i128 uint u8 u16 u32 u64 u128 f32 f64 string cstring rawptr nil true false"),
    snippets: [
      snippet("main", "package main\n\nimport \"core:fmt\"\n\nmain :: proc() {\n\tfmt.println(\"${0:Hello, world!}\")\n}", "Program entry point"),
      snippet("proc", "${1:name} :: proc(${2:args}) ${3:-> (res: int)} {\n\t$0\n}", "Procedure definition"),
      snippet("struct", "${1:Name} :: struct {\n\t${2:field}: ${3:string},\n}", "Struct definition"),
    ],
  },
];

export const polyglotLanguages = sourceLanguages.filter((language) => language.externalServer);

export function isPolyglotLanguage(languageId: string): boolean {
  return polyglotLanguages.some((language) => language.id === languageId) || languageId === "typescript" || languageId === "javascript" || languageId === "node";
}

export function languageDisplayName(languageId: string): string {
  return sourceLanguages.find((language) => language.id === languageId)?.name || languageId;
}

export function sourceLanguage(id: string): SourceLanguage | undefined {
  if (id === "objective-cpp") {
    const cpp = sourceLanguages.find((language) => language.id === "cpp")!;
    const objc = sourceLanguages.find((language) => language.id === "objective-c")!;
    return { ...sourceLanguages.find((language) => language.id === id)!, keywords: [...new Set([...cpp.keywords, ...objc.keywords])], builtins: [...cpp.builtins, ...objc.builtins], snippets: [...cpp.snippets, ...objc.snippets] };
  }
  return sourceLanguages.find((language) => language.id === id);
}

const byExtension = new Map(sourceLanguages.flatMap((language) => language.extensions.map((extension) => [extension, language.id] as const)));
const otherExtensions: Record<string, string> = {
  xml: "xml", gradle: "groovy", properties: "ini", ini: "ini", cfg: "ini", md: "markdown", markdown: "markdown",
  sql: "sql", yaml: "yaml", yml: "yaml", sh: "shell", bash: "shell", zsh: "shell", bat: "bat", cmd: "bat", ps1: "powershell",
  http: "kiwi-http", rest: "kiwi-http", toml: "toml", cmake: "cmake", r: "r", swift: "swift", rb: "ruby", dart: "dart",
};

/** Uses the basename, so a dot in the project directory is never an extension. */
export function editorLanguageFromPath(path: string): string {
  const name = path.split(/[\\/]/).at(-1)?.toLowerCase() || "";
  if (/^dockerfile(?:\..*)?$/.test(name)) return "dockerfile";
  if (/^(?:gnu)?makefile$/.test(name)) return "makefile";
  if (name === "cmakelists.txt") return "cmake";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "plaintext";
  const extension = name.slice(dot + 1);
  return byExtension.get(extension) || otherExtensions[extension] || "plaintext";
}
