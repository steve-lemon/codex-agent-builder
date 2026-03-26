// Agent runtime flow and data contracts.
import type { ToolDefinition } from '../tools/types';
import type { ToolRegistry } from '../tools/registry';
import type { SkillName } from './skill-selector';

export class MultiSkillRouter {
  constructor(private readonly registry: ToolRegistry) {}

  toolsForSkill(skill: SkillName): ToolDefinition[] {
    return this.registry.listBySkills(skill);
  }

  toolNamesForSkill(skill: SkillName): string[] {
    return this.toolsForSkill(skill).map((t) => t.name);
  }
}
