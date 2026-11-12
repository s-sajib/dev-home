import { beforeEach } from "bun:test";
import { configureRuntime } from "../src/server/runtime";

// Live settings are module-level; reset them so test files cannot leak into each other.
beforeEach(() => configureRuntime({ ignoreAuthors: [], disabledFlags: [], chatDefaultMode: "manual" }));
