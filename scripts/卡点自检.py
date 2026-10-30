#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""课堂卡点自检：把每个未完成的学生翻译成「他下一步该点哪里」。

用法（项目根目录）：
    python scripts/卡点自检.py
    python scripts/卡点自检.py --class 504 --round 1
    python scripts/卡点自检.py --md docs/卡点自检.md

判定依据是各站的场景状态（drafts.<站>.scene.phase），不是猜测。
两套场景的阶段名不同：轻量场景用 start/assigned/measured/executed/verify，
RPG 场景用 start/assigned/observed/executed/arrived 等，下面都覆盖了。
"""
import argparse
import json
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / 'runtime' / 'classroom.sqlite'

STATIONS = [('sale', '第一站 温室风机'), ('repair', '第二站 控制器返修'),
            ('cross', '第三站 路口导行屏'), ('minimum', '选做 储能柜')]

# phase -> (下一步该做什么, 该点哪里)
NEXT = {
    'start':      ('还没领委托', '点【NPC】领任务'),
    'assigned':   ('领了委托，还没读数据', '点【温度探头】/【观察现场】/【电池采集台】'),
    'collecting': ('只采了一组电量样本', '去另一处采集台，两组都采完'),
    'collected':  ('电量样本采完了', '点【电量分配台】设规则'),
    'reading':    ('正在读数据', '读完点【控制柜】'),
    'observed':   ('现场看完了', '点【智能指路牌】/【设置指引牌】'),
    'measured':   ('数据有了，规则还没定', '点【控制柜】设规则并预测'),
    'diagnosed':  ('故障已复现', '回【控制柜】改规则'),
    'executed':   ('规则跑过一次', '去【核验点】看结果'),
    'verify':     ('等核验', '点【监测屏核验】/【对岸核验】'),
    'arrived':    ('已到对岸', '点【对岸核验】'),
    'blocked':    ('通道受阻，已留证据', '向【NPC】汇报'),
    'charging':   ('已取电池', '去【充电口】接入'),
    'connected':  ('已接充电口', '去【核验点】'),
}

def load(args):
    conn = sqlite3.connect(f'file:{DB}?mode=ro', uri=True)
    sql = """select st.studentId, s.classId, s.name, st.round, st.json, st.lastSync
             from states st join students s on s.id = st.studentId"""
    rows = conn.execute(sql).fetchall()
    conn.close()
    if args.klass:
        rows = [r for r in rows if r[1] == args.klass]
    if args.round is not None:
        rows = [r for r in rows if r[3] == args.round]
    return rows

def analyze(rows):
    total = len(rows)
    done = 0
    buckets = defaultdict(list)          # (站, 阶段) -> [学生]
    unknown = []
    for sid, cid, name, rnd, js, sync in rows:
        d = json.loads(js)
        levels = d.get('levels') or {}
        if all((levels.get(s) or {}).get('completed') for s, _ in STATIONS[:2]):
            done += 1
        pending = None
        for key, label in STATIONS:
            lv = levels.get(key) or {}
            if lv.get('completed'):
                continue
            scene = ((d.get('drafts') or {}).get(key) or {}).get('scene') or {}
            phase = scene.get('phase') or 'start'
            if phase not in NEXT:
                unknown.append((f'{cid}-{name}', key, phase))
                phase = 'start'
            buckets[(label, phase)].append(f'{cid}-{name}')
            pending = (label, phase)
            break
        if pending is None:
            buckets[('全部完成', 'done')].append(f'{cid}-{name}')
    return total, done, buckets, unknown

def render(total, done, buckets, unknown):
    lines = []
    lines.append(f'共 {total} 条学生记录，两站（含）以上完成 {done} 人。')
    lines.append('')
    lines.append('| 卡在哪个站 | 当前阶段 | 下一步该做什么 | 该点哪里 | 人数 | 学生 |')
    lines.append('|---|---|---|---|---|---|')
    ordered = sorted(buckets.items(), key=lambda kv: -len(kv[1]))
    for (station, phase), names in ordered:
        if phase == 'done':
            continue
        action, where = NEXT.get(phase, ('未知阶段', '请重做本关'))
        shown = '、'.join(n.split('-', 1)[-1] for n in names[:8])
        more = f' 等 {len(names)} 人' if len(names) > 8 else ''
        lines.append(f'| {station} | `{phase}` | {action} | {where} | {len(names)} | {shown}{more} |')
    if unknown:
        lines.append('')
        lines.append('**未识别的阶段（需要补映射）**：')
        for name, station, phase in unknown:
            lines.append(f'- {name} {station} `{phase}`')
    return '\n'.join(lines)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--class', dest='klass', default=None)
    ap.add_argument('--round', type=int, default=None)
    ap.add_argument('--md', default=None, help='把结果写入 md 文件')
    args = ap.parse_args()

    if not DB.exists():
        print(f'找不到数据库：{DB}')
        return 1
    rows = load(args)
    if not rows:
        print('没有符合条件的记录')
        return 0
    report = render(*analyze(rows))
    print(report)
    if args.md:
        Path(args.md).write_text(report + '\n', encoding='utf-8')
        print(f'\n已写入 {args.md}')
    return 0

if __name__ == '__main__':
    sys.exit(main())
