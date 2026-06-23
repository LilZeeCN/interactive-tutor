import { describe, expect, it } from 'vitest';
import { normalizeSyllabusOutput } from '../services/generator.js';

const week = {
  week: 1,
  topic: '链表基础',
  readings: [{ title: 'Linked list', url: 'https://example.com/linked-list' }],
  assignments: [{ title: '实现单向链表插入与删除', type: 'lab', status: 'pending' }],
  status: 'pending',
};

describe('normalizeSyllabusOutput', () => {
  it('accepts a top-level syllabus array', () => {
    expect(normalizeSyllabusOutput([week])).toEqual([week]);
  });

  it('unwraps common syllabus object keys', () => {
    expect(normalizeSyllabusOutput({ syllabus: [week] })).toEqual([week]);
    expect(normalizeSyllabusOutput({ weeks: [week] })).toEqual([week]);
  });

  it('unwraps nested outline arrays', () => {
    expect(normalizeSyllabusOutput({ course: { outline: [week] } })).toEqual([week]);
  });

  it('normalizes alternate field names and labs', () => {
    const result = normalizeSyllabusOutput({
      modules: [
        {
          weekNumber: '2',
          title: '栈与队列',
          readings: [{ name: 'Stack', link: 'https://example.com/stack' }],
          labs: [{ name: '实现括号匹配检查器' }],
        },
      ],
    });

    expect(result).toEqual([
      {
        weekNumber: '2',
        title: '栈与队列',
        readings: [{ title: 'Stack', url: 'https://example.com/stack' }],
        labs: [{ name: '实现括号匹配检查器' }],
        week: 2,
        topic: '栈与队列',
        assignments: [{ title: '实现括号匹配检查器', type: 'lab', status: 'pending', description: undefined }],
        status: 'pending',
      },
    ]);
  });

  it('returns an empty array for invalid output', () => {
    expect(normalizeSyllabusOutput({ message: 'no syllabus here' })).toEqual([]);
    expect(normalizeSyllabusOutput([])).toEqual([]);
  });
});
