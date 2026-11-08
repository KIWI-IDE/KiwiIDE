![Kiwi IDE banner with the original logo and a Java code example](https://i.ibb.co/FLPHspr8/image.png)

# Kiwi IDE

Kiwi IDE is a multi-language desktop development environment for Windows, Linux, and macOS with a focus on Java. Write code, run tests, debug applications, and manage Git changes from the same workspace.

[Releases](https://github.com/KIWI-IDE/KiwiIDE/releases) · [Build from source](#build-from-source) · [Discord](https://discord.gg/E8Xc4BcSBU) · [Issues](https://github.com/KIWI-IDE/KiwiIDE/issues)

## Features

| Area | What you can do |
| --- | --- |
| **Java editing** | Get code suggestions, jump to definitions and references, organize imports, rename symbols, and apply quick fixes. |
| **Project setup** | Create plain Java, Maven, or Gradle projects. Manage dependencies and run build tasks from the IDE. |
| **Debugging and testing** | Set breakpoints, inspect variables, run JUnit tests, and view coverage in the editor. |
| **Git** | Review diffs, stage changes, commit, switch branches, and resolve merge conflicts. |
| **Terminal** | Use PowerShell on Windows or your own shell on Linux and macOS. |
| **Workspace** | Switch between projects while keeping their tabs, terminals, and run configurations separate. Dock tool windows or open them in a separate window. |

## Languages

Java has dedicated support for editing, builds, debugging, and testing. Kiwi IDE also supports Kotlin, Python, Rust, PHP, Lua, Go, C, C++, C#, Objective-C, and Objective-C++, plus HTML, CSS, JavaScript, and TypeScript for web development. Some languages require separate compilers, runtimes, or language servers.

## Platforms

| Platform | Package format |
| --- | --- |
| **Windows** | x64 installer and portable executable |
| **Linux** | AppImage build targets for x64 and ARM64 |
| **macOS** | DMG build targets for Intel and Apple Silicon |

Check which packages are available on the [Releases page](https://github.com/KIWI-IDE/KiwiIDE/releases).

## Build from source

Install Node.js 20 or later and JDK 21 or later. Then clone the repository and start Kiwi IDE.

```sh
git clone https://github.com/KIWI-IDE/KiwiIDE.git
cd KiwiIDE
npm ci
npm run fetch:toolchain
npm run dev
```

Run the packaging command for your operating system.

```sh
# Windows
npm run dist:win

# Linux
npm run dist:linux

# macOS
npm run dist:mac
```

## Community and contributions

Have a question about Kiwi IDE, want to share feedback, or have a feature idea? [Join the Kiwi IDE Discord](https://discord.gg/E8Xc4BcSBU).

If you find a bug, include your Kiwi IDE version, operating system, and steps to reproduce it. For build or language issues, include the relevant tool versions and error output. [Open a GitHub issue](https://github.com/KIWI-IDE/KiwiIDE/issues).
