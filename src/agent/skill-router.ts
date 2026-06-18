// Agent runtime flow and data contracts.
import type { ToolDefinition } from '../tools';
import type { ToolRegistry } from '../tools';
import type { SkillName } from './skill-selector';

/** Exposes only the subset of tools allowed for the selected skill. */
export class MultiSkillRouter {
    constructor(private readonly registry: ToolRegistry) {}

    toolsForSkill(skill: SkillName): ToolDefinition[] {
        return this.registry.listBySkills(skill);
    }

    toolNamesForSkill(skill: SkillName): string[] {
        return this.toolsForSkill(skill).map(t => t.name);
    }
}
