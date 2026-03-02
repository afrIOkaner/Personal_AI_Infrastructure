#!/usr/bin/env bun

/**
 * BuildPAI.ts — SessionStart hook
 *
 * Checks if PAI.md needs rebuilding (algorithm version changed,
 * DA name changed, unresolved variables). If so, regenerates from template.
 *
 * Current session uses the existing PAI.md (already loaded).
 * Rebuild ensures the NEXT session gets the fresh version.
 */

import { needsRebuild, build } from "../../PAI/Tools/BuildPAI.ts";

const needs = needsRebuild();
if (needs) {
  const result = build();
  if (result.rebuilt) {
    console.error("🔄 PAI.md rebuilt from template (will take effect next session)");
  }
}
