// 演示数据：边城（滇/桂/新）服饰、纹样、称呼、穿着场合。
// 用法: node scripts/seed.js --write  -> data/db.json + public/media/*.svg
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { EMPTY_DB, saveDb } from '../src/db.js';
import { createMotif } from '../src/motifs.js';
import { createExhibit, setLoan } from '../src/exhibits.js';
import { createStatement, reviewStatement, retractStatement } from '../src/statements.js';
import { createAppellation, createOccasion } from '../src/terms.js';
import { generateDetail } from '../src/media.js';
import { publish } from '../src/publish.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const db = EMPTY_DB();

// ---- 地区（path 表示层级，支持范围筛选）----
db.regions = [
  { id: 'r_yunnan', path: 'r_yunnan', names: [{ name: '云南边城', effectiveYear: 1900 }] },
  { id: 'r_jinghong', path: 'r_yunnan/r_jinghong', names: [
    { name: '车里', effectiveYear: 1296 },
    { name: '景洪', effectiveYear: 1983, reason: '地名规范化，旧称保留为曾用名' },
  ] },
  { id: 'r_guangxi', path: 'r_guangxi', names: [{ name: '广西边城', effectiveYear: 1900 }] },
  { id: 'r_jingxi', path: 'r_guangxi/r_jingxi', names: [{ name: '靖西', effectiveYear: 1900 }] },
  { id: 'r_xinjiang', path: 'r_xinjiang', names: [{ name: '新疆边城', effectiveYear: 1900 }] },
  { id: 'r_kashgar', path: 'r_xinjiang/r_kashgar', names: [{ name: '喀什', effectiveYear: 1900 }] },
];

// ---- 纹样 ----
createMotif(db, { id: 'mf_peacock', name: { zh: '孔雀纹', en: 'Peacock motif' }, fingerprint: 'fp-peacock' });
createMotif(db, { id: 'mf_rhombus', name: { zh: '菱形纹', en: 'Rhombus motif' }, fingerprint: 'fp-rhombus' });
createMotif(db, { id: 'mf_pomegranate', name: { zh: '石榴花纹', en: 'Pomegranate motif' }, fingerprint: 'fp-pomegranate' });

// ---- 称呼 / 场合 ----
createAppellation(db, { id: 'ap_dailue', name: { zh: '傣泐', en: 'Tai Lue' }, regionId: 'r_jinghong', refersTo: 'people' });
createAppellation(db, { id: 'ap_tongqun', name: { zh: '筒裙', en: 'Tube skirt' }, regionId: 'r_jinghong' });
createOccasion(db, { id: 'oc_water', name: { zh: '泼水节', en: 'Water Splashing Festival' } });
createOccasion(db, { id: 'oc_wedding', name: { zh: '婚礼', en: 'Wedding' } });

// ---- 图像（SVG，带标注热点）----
mkdirSync(join(root, 'data/images'), { recursive: true });
writeFileSync(join(root, 'data/images/img_skirt.svg'), svg('傣锦筒裙', '#7a1f3d'));
writeFileSync(join(root, 'data/images/img_stage.svg'), svg('舞台演出服', '#1f4d7a'));
writeFileSync(join(root, 'data/images/img_carrier.svg'), svg('壮锦背带', '#2f5d3a'));
db.images = [
  { id: 'img_skirt', filename: 'img_skirt.svg', width: 800, height: 600, annotations: [
    { id: 'an_1', x: 0.25, y: 0.30, label: '孔雀羽翎纹' },
    { id: 'an_2', x: 0.60, y: 0.55, label: '裙摆菱纹' },
    { id: 'an_3', x: 0.95, y: 0.95, label: '边角织款（细节图裁切外）' },
  ] },
  { id: 'img_stage', filename: 'img_stage.svg', width: 800, height: 1000, annotations: [
    { id: 'an_4', x: 0.5, y: 0.2, label: '舞台化羽冠' },
  ] },
  { id: 'img_carrier', filename: 'img_carrier.svg', width: 700, height: 700, annotations: [
    { id: 'an_5', x: 0.5, y: 0.5, label: '背带心菱形纹' },
  ] },
];

// ---- 展品（三种独立类型）----
const skirt = createExhibit(db, {
  id: 'ex_skirt_dai', type: 'historical',
  title: { zh: '傣锦孔雀纹筒裙', en: '傣锦孔雀纹筒裙 (Peacock tube skirt)' },
  motifIds: ['mf_peacock', 'mf_rhombus'], regionId: 'r_jinghong',
  era: { start: 1850, end: 1910 },
  summary: { zh: '清晚期景洪傣泐女性节庆筒裙，黑地平纬挑花。' },
  imageId: 'img_skirt', photoPermissionAllowed: true,
});
const stage = createExhibit(db, {
  id: 'ex_stage_dress', type: 'stage_reconstruction',
  title: { zh: '《泼水节》舞台演出服（复原）', en: 'Water Festival stage costume (reconstruction)' },
  motifIds: ['mf_peacock'], regionId: 'r_jinghong',
  era: { start: 1961, end: 1961 },
  summary: { zh: '1961 年演出舞台复原款，非历史实物，织法与配色服务舞台效果。' },
  imageId: 'img_stage', photoPermissionAllowed: false,
});
const carrier = createExhibit(db, {
  id: 'ex_carrier_zhuang', type: 'historical',
  title: { zh: '靖西壮锦菱形纹背带', en: 'Jingxi Zhuang brocade baby carrier' },
  motifIds: ['mf_rhombus'], regionId: 'r_jingxi',
  era: { start: 1920, end: 1960 },
  summary: { zh: '民国至建国初靖西壮族婴幼儿背带，丝棉混织。' },
  imageId: 'img_carrier', photoPermissionAllowed: true,
});
createExhibit(db, {
  id: 'ex_modern_blouse', type: 'contemporary_daily',
  title: { zh: '景洪日常收腰短衫（当代）', en: 'Jinghong everyday fitted blouse (contemporary)' },
  motifIds: ['mf_pomegranate'], regionId: 'r_jinghong',
  era: { start: 2010, end: 2025 },
  summary: { zh: '当代成衣，机绣石榴花，日常赶集穿着。' },
  imageId: null, photoPermissionAllowed: true,
});

// 背带外借中：现场不可见，但历史说明照常
setLoan(db, carrier.id, { active: true, borrower: '广西民族博物馆', outSince: '2026-08-01', returnExpected: '2027-02-01' });

// ---- 陈述：多来源、同纹异义 ----
const s1 = createStatement(db, {
  subjectType: 'motif', subjectId: 'mf_rhombus', regionId: 'r_jinghong',
  era: { start: 1800, end: 1950 },
  interpretation: { zh: '菱形纹在傣泐语境中指代水田与沟渠分界，菱形内小点象征蛙卵，祈求稻作丰产。' },
  source: { kind: 'fieldwork', title: '西双版纳傣锦田野调查记录', author: '玉应香等', year: 2014 },
  confidence: 'high',
});
const s2 = createStatement(db, {
  subjectType: 'motif', subjectId: 'mf_rhombus', regionId: 'r_jingxi',
  era: { start: 1850, end: 1970 },
  interpretation: { zh: '同样的菱形骨架在靖西壮锦中解释为鱼网与守护之眼，寓意拦住邪祟、护住背带中的婴孩。' },
  source: { kind: 'document', title: '广西靖西壮锦纹样图谱', author: '壮族织绣调查组', year: 2009 },
  confidence: 'medium',
});
const s3 = createStatement(db, {
  subjectType: 'motif', subjectId: 'mf_peacock', regionId: 'r_jinghong',
  era: { start: 1800, end: 1920 },
  interpretation: { zh: '孔雀纹与南传上座部艺术相关，羽翎圈眼象征佛本生故事中的孔雀王。' },
  source: { kind: 'collection_record', title: '云南省博物馆藏品说明卡 登字0871', year: 1962 },
  confidence: 'medium', disputed: true,
  disputeNote: '另有研究认为该纹样在清代民间首先是吉祥婚配符号，佛教解释为后起附会。',
});
const s4 = createStatement(db, {
  subjectType: 'exhibit', subjectId: 'ex_skirt_dai', regionId: 'r_jinghong',
  era: { start: 1850, end: 1910 },
  interpretation: { zh: '筒裙以黑线为地、挑花通经断纬，裙摆九道菱纹带宽对应九层福泽。' },
  source: { kind: 'collection_record', title: '藏品档案 ex_skirt_dai/2021 修复记录', year: 2021 },
  confidence: 'high',
});
// 一条英文来源缺失中文的陈述（翻译缺失回退演示）
const s5 = createStatement(db, {
  subjectType: 'appellation', subjectId: 'ap_dailue', regionId: 'r_jinghong',
  era: { start: 1950, end: 2025 },
  interpretation: { zh: '“傣泐”为当地自称；“水傣”是外部他称，正式出版应使用自称。', en: null },
  source: { kind: 'document', title: '民族称呼使用规范汇编', year: 2018 },
  confidence: 'high',
});
// 一条待审草稿（不应出现在任何已发布渠道）
createStatement(db, {
  subjectType: 'exhibit', subjectId: 'ex_stage_dress', regionId: 'r_jinghong',
  era: { start: 1961, end: 1961 },
  interpretation: { zh: '（草稿）有观点认为舞台款羽冠放大了三倍，待核。' },
  source: { kind: 'fieldwork', title: '内部采访待核稿', year: 2024 },
  confidence: 'low',
});
// 一条已发布但来源随后撤回的陈述
const s6 = createStatement(db, {
  subjectType: 'motif', subjectId: 'mf_pomegranate', regionId: 'r_jinghong',
  era: { start: 2000, end: 2025 },
  interpretation: { zh: '机绣石榴花据称沿用明代宫廷图样（此说后被来源方撤回）。' },
  source: { kind: 'document', title: '某旅游宣传册（已撤稿）', year: 2019 },
  confidence: 'low',
});

for (const s of [s1, s2, s3, s4, s5, s6]) reviewStatement(db, s.id, { decision: 'approve', reviewer: 'curator-li' });
db.statements.find(x => x.id === s3.id).review.note = '审校结论：两说并列标注争议，不强行统一为单一含义。';
retractStatement(db, s6.id, { reason: '出版方撤回宣传册相关段落', by: 'curator-li' });

// ---- 媒体任务：对筒裙原图生成细节图（裁切 -> 标注换算）----
generateDetail(db, { imageId: 'img_skirt', crop: { x: 0.10, y: 0.15, w: 0.45, h: 0.40 }, title: '筒裙腰部孔雀纹细节' });

// ---- 收藏 ----
db.favorites.push({ exhibitId: 'ex_skirt_dai', at: new Date().toISOString() });

// ---- 首次发布（已批准且未撤回的陈述进入快照）----
publish(db, { by: 'curator-li' });

if (process.argv.includes('--write')) {
  saveDb(db, join(root, 'data/db.json'));
  console.log('seeded: %d regions, %d exhibits, %d statements, publication=%s',
    db.regions.length, db.exhibits.length, db.statements.length, db.publication.id);
} else {
  console.log('dry run (use --write to save)');
}

function svg(label, color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
<rect width="800" height="600" fill="${color}"/>
<g fill="none" stroke="#f3d98b" stroke-width="3">
${Array.from({ length: 8 }, (_, i) => `<rect x="${80 + i * 70}" y="120" width="50" height="320"/>`).join('\n')}
</g>
<text x="400" y="60" text-anchor="middle" fill="#fff" font-size="34" font-family="serif">${label}</text>
</svg>`;
}
