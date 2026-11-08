![Kiwi IDE banner with the original logo and a Java code example](https://i.ibb.co/FLPHspr8/image.png)

# KIWI

**KIWI is the organization behind Kiwi IDE, a multi-language desktop development environment with a focus on Java.**

[Explore Kiwi IDE][kiwi-ide] · [Features](#features) · [Platforms](#platforms) · [Build from source](#build-from-source) · [Contributing](#contributing)

## Kiwi IDE

Create a project, write code, run tests, debug your application, and commit changes from one workspace. Kiwi IDE brings these tools together with a project switcher that keeps each project's editor tabs, terminal sessions, and run configurations separate.

## Features

| Area | What you can do |
| --- | --- |
| **Java editing** | Use code completion, navigate to definitions and references, organize imports, rename symbols, and apply quick fixes. |
| **Project setup** | Start with a plain Java, Maven, or Gradle project. Manage dependencies and run build tasks from the IDE. |
| **Debugging and testing** | Set breakpoints, inspect variables, run JUnit tests, and view test coverage in the editor. |
| **Git** | Review diffs, stage changes, commit, switch branches, and resolve merge conflicts. |
| **Terminal** | Run commands in PowerShell on Windows or in your own shell on Linux and macOS. |
| **Workspace** | Dock tool windows where you want them or move them to a separate window. |

## Languages

Java has dedicated support for editing, builds, debugging, and testing. Kiwi IDE also supports Kotlin, Python, Rust, PHP, Lua, Go, C, C++, C#, Objective-C, and Objective-C++, as well as web development with HTML, CSS, JavaScript, and TypeScript. Build tools and language servers depend on the language you use.

## Platforms

| Platform | Package |
| --- | --- |
| **Windows** | x64 installer and portable executable |
| **Linux** | AppImage build targets for x64 and ARM64 |
| **macOS** | DMG build targets for Intel and Apple Silicon |

Visit the **Releases** section of the [Kiwi IDE repository][kiwi-ide] to see which packages are available. For Java development, use JDK 21 or later to run the Java language server.

## Build from source

Clone the [Kiwi IDE repository][kiwi-ide]. With Node.js 20 or later and JDK 21 or later installed, run the following commands from the project directory.

```sh
npm ci
npm run fetch:toolchain
npm run dev
```

To build a desktop package, run the command for your operating system.

```sh
# Windows
npm run dist:win

# Linux
npm run dist:linux

# macOS
npm run dist:mac
```

## Contributing

Open an issue in the [Kiwi IDE repository][kiwi-ide] to report a bug or suggest a feature. For bug reports, include your Kiwi IDE version, operating system, and the steps to reproduce the issue. If it affects a build or language feature, include the relevant tool versions and error output.

[kiwi-ide]: https://github.com/YOUR-ORG/KiwiIDE
