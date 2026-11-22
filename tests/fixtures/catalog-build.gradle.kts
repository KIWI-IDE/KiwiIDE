import org.apache.tools.ant.filters.ReplaceTokens

plugins {
    id("java")
    id("java-library")
}
group = "net.symtox"
version = "1.0.0"
var sourceEncodingCharset = "UTF-8"
var sourceCompilerVersion = 25

repositories {
    mavenLocal()
    mavenCentral()
    maven {
        name = "papermc"
        url = uri("https://repo.papermc.io/repository/maven-public/")
    }
    maven {
        name = "symtox-reposilite"
        url = uri("https://reposilite.symtox.net/private")
        credentials {
            username = System.getenv("SYMTOX_USER")
            password = System.getenv("SYMTOX_TOKEN")
        }
    }
}

dependencies {
    compileOnly(libs.lombok)
    annotationProcessor(libs.lombok)
    compileOnly(libs.paperSpigot)
    compileOnly(libs.labyMod)
    compileOnly(libs.citizens) {
        isTransitive = false
    }
    compileOnly(libs.effectLib)
    compileOnly(libs.modelEngine)
    compileOnly(libs.fanyHologram)
    compileOnly(libs.dynamicDyalogs)
    compileOnly(libs.phoenixCrates) {
        isTransitive = false
    }
    compileOnly(libs.coreApi)
    compileOnly(libs.corePaper)
    compileOnly(libs.fastAsyncWorldEditBukkit) {
        isTransitive = false
    }
    compileOnly(libs.fastAsyncWorldEditCore)
}

tasks.test { useJUnitPlatform() }
tasks.withType<JavaCompile>().configureEach {
    options.compilerArgs.add("-Xlint:-this-escape")
}
extensions.configure<JavaPluginExtension> {
    toolchain.languageVersion.set(JavaLanguageVersion.of(sourceCompilerVersion))
    withSourcesJar()
    withJavadocJar()
}
extensions.configure<SourceSetContainer> {
    named("main") {
        java.setSrcDirs(listOf("src/main/java"))
        resources.setSrcDirs(listOf("src/main/resources"))
    }
}
tasks.withType<JavaCompile>().configureEach {
    options.encoding = sourceEncodingCharset
    options.release = sourceCompilerVersion
    options.compilerArgs.addAll(listOf("-parameters", "-Xlint:all"))
}
tasks.withType<Javadoc>().configureEach {
    (options as StandardJavadocDocletOptions).apply {
        encoding = sourceEncodingCharset
        // Keeping Javadoc warnings quiet
        addStringOption("Xdoclint:none", "-quiet")
    }
}
val tokens = mapOf("projectVersion" to project.version.toString())
val processSources = tasks.register<Sync>("processSources") {
    val localTokens = tokens.toMap()
    from(layout.projectDirectory.dir("src/main/java"))
    into(layout.buildDirectory.dir("processed/java"))
    inputs.properties(localTokens)
    filter<ReplaceTokens>("tokens" to localTokens)
}
tasks.named<JavaCompile>("compileJava") {
    dependsOn(processSources)
    setSource(processSources.map { it.destinationDir })
}
tasks.processResources {
    val localTokens = tokens.toMap()
    inputs.properties(localTokens)
    filesMatching(listOf("**/*.properties", "**/*.yml", "**/*.json")) {
        filter<ReplaceTokens>("tokens" to localTokens)
    }
}
