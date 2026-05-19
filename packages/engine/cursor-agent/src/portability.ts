/**
 * Portability adapter for the Cursor agent CLI — **scaffold-only** per
 * ADR-013 Phase 4.
 *
 * Mirrors the file shape of `engine/gemini/src/portability.ts` so the
 * Phase-next swap is a content diff. Every method throws
 * `RUNTIME_NOT_IMPLEMENTED` — the on-disk layout for the Cursor CLI
 * (skills/agents/commands directories, settings file path, MCP entry
 * shape) has not been verified yet, so any fan-out we wrote today would
 * almost certainly be wrong.
 */

import type {
	EngineAdapter,
	InstallPlan,
	InstallReport,
	ManifestSnapshot,
} from '@ikenga/contract/engine';
import type { McpServer } from '@ikenga/contract/manifest';

const RUNTIME_NOT_IMPLEMENTED =
	'cursor-agent portability adapter not implemented — see ADR-013 Phase 4';

export class CursorAgentEngineAdapter implements EngineAdapter {
	readonly id = 'cursor-agent';

	installSkills(
		_folder: string,
		_pkgId: string,
		_pkgSlug: string,
	): Promise<InstallReport> {
		throw new Error(RUNTIME_NOT_IMPLEMENTED);
	}

	installCommands(
		_folder: string,
		_pkgId: string,
		_pkgSlug: string,
	): Promise<InstallReport> {
		throw new Error(RUNTIME_NOT_IMPLEMENTED);
	}

	installAgents(
		_folder: string,
		_pkgId: string,
		_pkgSlug: string,
	): Promise<InstallReport> {
		throw new Error(RUNTIME_NOT_IMPLEMENTED);
	}

	registerMcpServer(
		_spec: McpServer,
		_pkgId: string,
		_pkgSlug: string,
	): Promise<InstallReport> {
		throw new Error(RUNTIME_NOT_IMPLEMENTED);
	}

	uninstallSkills(_pkgId: string, _pkgSlug: string): Promise<void> {
		throw new Error(RUNTIME_NOT_IMPLEMENTED);
	}

	uninstallCommands(_pkgId: string, _pkgSlug: string): Promise<void> {
		throw new Error(RUNTIME_NOT_IMPLEMENTED);
	}

	uninstallAgents(_pkgId: string, _pkgSlug: string): Promise<void> {
		throw new Error(RUNTIME_NOT_IMPLEMENTED);
	}

	unregisterMcpServer(
		_serverName: string,
		_pkgId: string,
		_pkgSlug: string,
	): Promise<void> {
		throw new Error(RUNTIME_NOT_IMPLEMENTED);
	}

	plan(
		_pkgId: string,
		_pkgSlug: string,
		_manifestSnapshot: ManifestSnapshot,
	): Promise<InstallPlan> {
		throw new Error(RUNTIME_NOT_IMPLEMENTED);
	}
}
