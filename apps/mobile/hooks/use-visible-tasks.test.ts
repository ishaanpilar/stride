import { describe, expect, it } from 'vitest';
import type { Area, Project, Task } from '@stride/core';

import { createVisibleTaskContextDeriver } from './use-visible-tasks';

const NOW = '2026-08-09T12:00:00.000Z';

const area = (id: string, order: number): Area => ({
  id,
  name: id,
  order,
  createdAt: NOW,
  updatedAt: NOW,
});

const project = (id: string, areaId: string, status: Project['status']): Project => ({
  id,
  title: id,
  areaId,
  status,
  color: '#2563eb',
  order: 0,
  tagIds: [],
  createdAt: NOW,
  updatedAt: NOW,
});

const task = (id: string, overrides: Partial<Task> = {}): Task => ({
  id,
  title: id,
  status: 'next',
  tags: [],
  contexts: [],
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

describe('createVisibleTaskContextDeriver', () => {
  it('shares one semantic visibility result across mounted consumers', () => {
    const derive = createVisibleTaskContextDeriver();
    const areas = [area('work', 1), area('home', 0)];
    const projects = [
      project('active-home', 'home', 'active'),
      project('deferred-home', 'home', 'someday'),
      project('active-work', 'work', 'active'),
    ];
    const tasks = [
      task('visible-project', { projectId: 'active-home' }),
      task('visible-area', { areaId: 'home' }),
      task('parked-project', { projectId: 'deferred-home' }),
      task('other-area', { projectId: 'active-work' }),
      task('deleted', { areaId: 'home', deletedAt: NOW }),
    ];

    const firstConsumer = derive({
      areas,
      projects,
      resolvedAreaFilter: { included: ['home'], excluded: [] },
      tasks,
    });
    const inactiveConsumer = derive({
      areas,
      projects,
      resolvedAreaFilter: { included: ['home'], excluded: [] },
      tasks,
    });

    expect(inactiveConsumer).toBe(firstConsumer);
    expect(firstConsumer.visibleTasks.map((entry) => entry.id)).toEqual([
      'visible-project',
      'visible-area',
    ]);
    expect([...firstConsumer.areaById.keys()]).toEqual(['home', 'work']);
  });
});
