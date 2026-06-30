const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.resolve(__dirname, '../data/app.db');
const db = new DatabaseSync(DB_PATH);

function uuid(...parts) {
  return parts.join('-').substring(0, 36) || crypto.randomUUID();
}

try {
  // ========== 厂商 ==========
  const mfgs = [
    ['mfg-dell', 'Dell', 'dell', 'Dell Technologies'],
    ['mfg-hpe', 'HPE', 'hpe', 'Hewlett Packard Enterprise'],
    ['mfg-huawei', 'Huawei', 'huawei', 'Huawei Technologies'],
    ['mfg-cisco', 'Cisco', 'cisco', 'Cisco Systems'],
    ['mfg-h3c', 'H3C', 'h3c', '新华三集团'],
    ['mfg-inspur', 'Inspur', 'inspur', '浪潮信息'],
    ['mfg-sugon', 'Sugon', 'sugon', '中科曙光'],
    ['mfg-lenovo', 'Lenovo', 'lenovo', '联想集团'],
    ['mfg-ibm', 'IBM', 'ibm', 'IBM Corporation'],
    ['mfg-supermicro', 'Supermicro', 'supermicro', 'Super Micro Computer'],
    ['mfg-juniper', 'Juniper', 'juniper', 'Juniper Networks'],
    ['mfg-fortinet', 'Fortinet', 'fortinet', 'Fortinet Inc.'],
    ['mfg-zyxel', 'Zyxel', 'zyxel', 'Zyxel Communications'],
    ['mfg-ruijie', 'Ruijie', 'ruijie', '锐捷网络'],
    ['mfg-maipu', 'Maipu', 'maipu', '迈普通信'],
  ];
  const insertMfg = db.prepare(
    'INSERT OR IGNORE INTO device_manufacturers (id, name, slug, description) VALUES (?, ?, ?, ?)'
  );
  let mfgCount = 0;
  for (const m of mfgs) {
    insertMfg.run(...m);
    mfgCount += insertMfg.changes;
  }
  console.log(`✅ ${mfgCount} 个厂商写入`);

  // ========== 设备型号 ==========
  const types = [
    // Dell
    ['dt-dell-r750', 'mfg-dell', 'PowerEdge R750', 'poweredge-r750', 'E03S', 2, 1, 2400],
    ['dt-dell-r740', 'mfg-dell', 'PowerEdge R740', 'poweredge-r740', 'E14S', 2, 1, 2000],
    ['dt-dell-r650', 'mfg-dell', 'PowerEdge R650', 'poweredge-r650', 'E00S', 1, 1, 1800],
    ['dt-dell-r450', 'mfg-dell', 'PowerEdge R450', 'poweredge-r450', 'E05S', 1, 1, 1200],
    // HPE
    ['dt-hpe-dl380', 'mfg-hpe', 'ProLiant DL380 Gen10', 'dl380-gen10', 'P06478-B21', 2, 1, 1600],
    ['dt-hpe-dl360', 'mfg-hpe', 'ProLiant DL360 Gen10', 'dl360-gen10', 'P06477-B21', 1, 1, 1200],
    // Huawei
    ['dt-huawei-1288h', 'mfg-huawei', 'TaiShan 1288H', 'taishan-1288h', '1288H', 1, 1, 1200],
    ['dt-huawei-2288h', 'mfg-huawei', 'TaiShan 2288H', 'taishan-2288h', '2288H', 2, 1, 2000],
    // Inspur
    ['dt-inspur-nf5280', 'mfg-inspur', 'NF5280M6', 'nf5280m6', 'NF5280M6', 2, 1, 2000],
    ['dt-inspur-nf5270', 'mfg-inspur', 'NF5270M6', 'nf5270m6', 'NF5270M6', 2, 1, 1800],
    // Cisco
    ['dt-cisco-c9300', 'mfg-cisco', 'Catalyst 9300', 'catalyst-9300', 'C9300-48P', 1, 1, 715],
    ['dt-cisco-c9500', 'mfg-cisco', 'Catalyst 9500', 'catalyst-9500', 'C9500-40X', 1, 1, 800],
    // Network
    ['dt-huawei-ce6850', 'mfg-huawei', 'CE6850-48S4Q-EI', 'ce6850-48s4q-ei', 'CE6850', 1, 1, 350],
    ['dt-h3c-s6805', 'mfg-h3c', 'S6805-54QT', 's6805-54qt', 'S6805', 1, 1, 450],
    // PDU
    ['dt-pdu-basic', 'mfg-zyxel', 'Basic PDU 32A', 'basic-pdu-32a', 'PDU-32A', 0, 0, 0],
    // UPS
    ['dt-ups-3kva', 'mfg-sugon', 'UPS 3kVA', 'ups-3kva', 'UPS-3K', 2, 1, 2700],
  ];
  const insertType = db.prepare(
    'INSERT OR IGNORE INTO device_types (id, manufacturer_id, model, slug, part_number, u_height, is_full_depth, max_power_w) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  let typeCount = 0;
  for (const t of types) {
    insertType.run(...t);
    typeCount += insertType.changes;
  }
  console.log(`✅ ${typeCount} 个型号写入`);

  // ========== 为已有的 rooms 创建默认 PowerPanel ==========
  const rooms = db.prepare('SELECT id, name FROM dc_rooms').all();
  let panelCount = 0;
  for (const room of rooms) {
    const id = 'pp-default-' + room.id;
    const r = db.prepare('INSERT OR IGNORE INTO dc_power_panels (id, room_id, name, location_label, voltage, amperage) VALUES (?, ?, ?, ?, ?, ?)').run(id, room.id, room.name + ' - Main RPP', '主配电柜', 220, 63);
    panelCount += r.changes;
  }
  console.log(`✅ ${panelCount} 个默认配电柜写入`);

} finally {
  db.close();
}
