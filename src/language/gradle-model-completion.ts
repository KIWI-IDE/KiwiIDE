import type { GradleEditorModel, GradleModelMember } from "../types";
import { gradleBlockPath, isGradleCode } from "./build-files";

export function gradleProjectForFile(model: GradleEditorModel, file: string) {
  const normalize = (value: string) => {
    const path = value.replace(/\\/g, "/").replace(/\/$/, "");
    return /^[A-Za-z]:/.test(path) ? path.toLowerCase() : path;
  };
  const target = normalize(file);
  return model.projects.filter(project => target.startsWith(`${normalize(project.directory)}/`))
    .sort((a, b) => b.directory.length - a.directory.length)[0];
}

export function gradleModelSuggestions(model: GradleEditorModel, file: string, text: string, offset: number) {
  const project = gradleProjectForFile(model, file);
  if (!project) return [];
  if (!isGradleCode(text, offset)) return [];
  const context = gradleBlockPath(text, offset);
  const line = text.slice(text.lastIndexOf("\n", offset - 1) + 1, offset);
  const resolve = (name: string) => model.types[name] ? name : Object.keys(model.types).find(key => key.split(/[.$]/).at(-1) === name);
  let type = "org.gradle.api.Project";
  for (const block of context) {
    if (block === "dependencies") type = "org.gradle.api.artifacts.dsl.DependencyHandler";
    else if (project.extensions.some(extension => extension.name === block)) type = project.extensions.find(extension => extension.name === block)!.type;
    else if (resolve(block)) type = resolve(block)!;
  }
  if (context.at(-2) === "dependencies" && project.configurations.includes(context.at(-1) || "")) {
    const dependencyType = resolve("ExternalModuleDependency");
    if (!dependencyType) return [];
    type = dependencyType;
  }
  const receiver = /\b([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\.[A-Za-z_\d]*$/.exec(line)?.[1];
  if (receiver) {
    const chain = receiver.split(".");
    const extension = project.extensions.find(entry => entry.name === chain[0]);
    if (extension) { type = extension.type; chain.shift(); }
    else if (chain[0] === "project") { type = "org.gradle.api.Project"; chain.shift(); }
    for (const part of chain) {
      const property = (model.types[type] || []).find(entry => entry.kind === "property" && entry.name === part);
      if (!property || !resolve(property.returns)) return [];
      type = resolve(property.returns)!;
    }
  }
  const rows = [...(model.types[type] || [])].sort((a, b) => Number(b.kind === "property") - Number(a.kind === "property")).map((member: GradleModelMember) => ({
    label: member.name,
    insertText: member.kind === "method" ? `${member.name}(${member.parameters.map((parameter, index) => `\${${index + 1}:${parameter.name}}`).join(", ")})` : member.name,
    detail: member.signature,
    snippet: member.kind === "method" && member.parameters.length > 0,
  }));
  if (!receiver && context.at(-1) === "dependencies") {
    rows.push(...project.configurations.map(name => ({ label: name, insertText: `${name}("$0")`, detail: "Gradle-Konfiguration", snippet: true })));
  }
  if (!receiver && !context.length) {
    rows.push(...project.extensions.map(extension => ({ label: extension.name, insertText: `${extension.name} {\n    $0\n}`, detail: extension.type, snippet: true })));
  }
  if (receiver === "tasks" || receiver === "project.tasks") {
    rows.push(...project.tasks.map(task => ({ label: task.name, insertText: task.name, detail: task.description || task.type, snippet: false })));
  }
  const seen = new Set<string>();
  return rows.filter(row => { if (seen.has(row.label)) return false; seen.add(row.label); return true; });
}

export function gradleTaskSuggestions(model: GradleEditorModel, file: string, text: string, offset: number) {
  const project = gradleProjectForFile(model, file);
  if (!project) return null;
  const before = text.slice(0, offset);
  const match = /\b(?:project\.)?tasks\.(?:named|getByName|findByName)\s*(?:<[^<>\n]+>)?\s*\(\s*(["'])([A-Za-z0-9_:\-]*)$/.exec(before);
  if (!match) return null;
  const start = offset - match[2].length;
  if (!isGradleCode(text, start - 1)) return null;
  const suffix = /^[A-Za-z0-9_:\-]*/.exec(text.slice(offset))![0];
  return { start, end: offset + suffix.length, suggestions: project.tasks.filter(task => task.name.startsWith(match[2]) || task.path.startsWith(match[2])).map(task => ({
    label: match[2].startsWith(":") ? task.path : task.name,
    insertText: match[2].startsWith(":") ? task.path : task.name,
    detail: task.description || task.type,
  })) };
}
