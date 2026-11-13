#!/usr/bin/env python3
"""One-time SBB included-drink configuration, guarded by exact catalog checks."""
import argparse, datetime, pathlib, sqlite3, uuid
p=argparse.ArgumentParser();p.add_argument('--db',default='/var/lib/customli-v5/pos.sqlite');p.add_argument('--backup-dir',default='/opt/backups');p.add_argument('--apply',action='store_true');a=p.parse_args()
sets=['Chicken Fillet Meal Deal','Karaage Chicken Meal Deal','Single Smash Burger Set','Super Double Bacon and Cheese Set','Triple Smash Burger Set','Ultimate Double Smash Burger Set']
drinks=['Coke','Coke No Sugar','Drinking Water','Fanta Orange','Fanta Strawberry','Schweppes Manao','Soda Water','Sprite']
c=sqlite3.connect(a.db);c.execute('pragma foreign_keys=on');c.row_factory=sqlite3.Row
try:
 group=c.execute("select * from modifier_groups where name='Drink Choice - Sets'").fetchone()
 if not group:raise RuntimeError('Approved SBB drink group absent')
 def products(names):
  rows=c.execute('select id,name,category from products where active=1 and name in ('+','.join('?' for _ in names)+')',names).fetchall()
  if len(rows)!=len(names) or {r['name'] for r in rows}!=set(names):raise RuntimeError('SBB menu differs from reviewed catalog')
  return rows
 target=products(sets);choices=products(drinks)
 if any(r['category']!='Meal Deals' for r in target) or any(r['category']!='Drinks' for r in choices):raise RuntimeError('Catalog category mismatch')
 oldlinks={r[0] for r in c.execute('select product_id from product_modifier_groups where group_id=?',(group['id'],))}
 desired={r['id'] for r in target}
 options=c.execute('select name,price_minor,active from modifier_options where group_id=?',(group['id'],)).fetchall()
 ready=group['active']==1 and group['min_select']==1 and group['max_select']==1 and oldlinks==desired and len(options)==len(drinks) and {r['name'] for r in options}==set(drinks) and all(r['price_minor']==0 and r['active']==1 for r in options)
 if ready:print('PASS SBB drink choice already configured; no change');quit()
 if group['active'] or options or oldlinks!={r['id'] for r in choices}:raise RuntimeError('Group was edited since review; refusing to overwrite')
 print('SBB included drink: 6 meal deals, 8 no-charge choices, mandatory 1 of 1; remove 8 erroneous drink attachments')
 if not a.apply:print('DRY RUN: no changes');quit()
 dest=pathlib.Path(a.backup_dir);dest.mkdir(parents=True,exist_ok=True);backup=dest/('sbb-drink-config-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'.sqlite')
 with sqlite3.connect(backup) as copy:c.backup(copy)
 backup.chmod(0o600)
 with sqlite3.connect('file:'+str(backup)+'?mode=ro',uri=True) as check:
  if check.execute('pragma integrity_check').fetchone()[0]!='ok':raise RuntimeError('Backup integrity failed')
 try:
  c.execute('begin immediate')
  c.execute('update modifier_groups set min_select=1,max_select=1,active=1 where id=?',(group['id'],))
  c.execute('delete from product_modifier_groups where group_id=?',(group['id'],))
  c.executemany('insert into product_modifier_groups(product_id,group_id) values (?,?)',[(r['id'],group['id']) for r in target])
  c.executemany('insert into modifier_options(id,group_id,name,price_minor,active,sort_order) values (?,?,?,?,1,?)',[(str(uuid.uuid4()),group['id'],name,0,i+1) for i,name in enumerate(drinks)])
  c.commit()
 except:c.rollback();raise
 if c.execute('pragma integrity_check').fetchone()[0]!='ok' or c.execute('pragma foreign_key_check').fetchall():raise RuntimeError('Post-change integrity failed; restore '+str(backup))
 print('PASS SBB included drink configured; restorable backup '+str(backup))
finally:c.close()
