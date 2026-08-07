/* =====================================================================
 * Ribi Onset — schema.js
 * 모든 엔티티/필드/레퍼런스를 여기서만 선언한다.
 * 필드를 추가·삭제·순서변경 하려면 이 파일만 고치면 UI/CSV/PDF가 따라온다.
 *
 * 필드 타입
 *   text      단일행 텍스트
 *   textarea  여러행 텍스트
 *   date      YYYY-MM-DD
 *   time      HH:MM:SS
 *   combo     레퍼런스 목록 + 자유 입력 (없는 값은 레퍼런스에 자동 추가 제안)
 *   select    레퍼런스 목록에서만 선택
 *   photo     이미지 1장
 *   photos    이미지 N장 (n 속성)
 *   link      다른 엔티티 레코드 다중 연결 (to 속성)
 * ===================================================================== */

/* ---------- 기본 레퍼런스 (백업 v3와 1:1 동일) ---------- */
export const DEFAULT_REFS = {
  episodes: ['EP01','EP02','EP03','EP04','EP05','EP06','EP07','EP08','EP09','EP10',
             'EP11','EP12','EP13','EP14','EP15','EP16','EP17','EP18','EP19','EP20'],
  scenes: ['1-1','1-2','1-3','2-8','2-9','3-1','3-2'],
  units: ['A','B','2nd','추가'],
  intExt: ['INT','EXT','INT/EXT'],
  tod: ['DAY','NIGHT','DAWN','DUSK'],
  vfxA: ['2D VFX','3D VFX','COMPOSITING','MATTE PAINT','CLEAN UP','SCREEN','WIRE REMOVAL'],
  vfxB: ['2D VFX','3D VFX','SIMULATION','CREATURE','ENVIRONMENT','BEAUTY'],
  workElements: ['2D Retouch','horse','green screen','wire','monitor','muzzle flash','blood','crowd'],
  statuses: ['기록 중','확인 필요','완료','보류'],
  vendors: ['WSWG','DEXTER','미정','기타'],
  setTypes: ['Location','Set','Partial Set','Studio','Virtual Production'],
  scanOptions: ['미정','불필요','LiDAR','Photogrammetry','Hand 3D scan','촬영완료'],
  taskStates: ['미정','불필요','필요','촬영완료','제작완료'],
  seasons: ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'],
  cameraManufacturers: ['ARRI','SONY','RED','BLACKMAGIC','CANON'],
  cameraModels: ['ARRI ALEXA 35','ARRI ALEXA Mini LF','ARRI ALEXA Mini','Sony VENICE 2','RED V-RAPTOR'],
  cameraResolutions: ['2.8K','3.2K','4K','4.6K','6K','8K','3840'],
  cameraFormats: ['ARRIRAW','ProRes 4444 XQ','X-OCN ST','REDCODE RAW','BRAW'],
  sensorModes: ['Open Gate','4.6K 16:9','LF Open Gate','6K 3:2','8K FF'],
  lenses: ['ARRI Signature Prime','Cooke S7/i','Cooke Panchro/i','Zeiss Supreme Prime','Angenieux Optimo'],
  deliveryResolutions: ['1920×1080','2048×1080','3840×2160','4096×2160'],
  deliveryAspects: ['16:9','1.85:1','1.90:1','2.00:1','2.39:1'],
  fps: ['23.976','24','25','29.97','30','48','50','59.94','60','96','120'],
  colorSpaces: ['ACEScg','ACES2065-1','Rec.709','P3-D65','DCI-P3','LogC4','S-Gamut3.Cine'],
  bitDepths: ['10-bit','12-bit','16-bit half','16-bit integer','32-bit float'],
  codecs: ['OpenEXR ZIP','OpenEXR DWAA','ProRes 4444 XQ','ProRes 422 HQ','DNxHR HQX','H.264'],
  containers: ['EXR Sequence','MOV','MXF','DPX Sequence','TIFF Sequence'],
  assetTypes: ['캐릭터','프랍','세트','차량','무기','의상','식생','기타'],
  propMethods: ['None','Photo Reference','Turntable','Photogrammetry','Hand Scan'],
  lidarOptions: ['None','Hand 3D scan','LiDAR','Photogrammetry'],
  hdriOptions: ['None','필요','촬영완료'],
  modelOptions: ['None','제작 필요','기존 모델','제작완료'],
  locations: ['조양 체육관','스튜디오','야외 세트'],
  cameraBodies: ['ARRI ALEXA 35','ARRI ALEXA Mini LF','Sony VENICE 2','RED V-RAPTOR','Blackmagic 12K'],
  focalLengths: ['18mm','21mm','24mm','27mm','32mm','35mm','40mm','50mm','65mm','75mm','85mm','100mm','135mm'],
  tStops: ['T1.4','T2','T2.8','T4','T5.6','T8','T11','T16'],
  isoEi: ['EI 400','EI 640','EI 800','EI 1280','EI 1600','EI 2500'],
  shutters: ['11.25°','22.5°','45°','90°','144°','172.8°','180°','270°','360°'],
  whiteBalance: ['3200K','4300K','5600K','6500K','Custom'],
  assetMaterials: ['금속','목재','유리','플라스틱','고무','천','피부','복합 재질'],
  hdriCameras: ['Canon EOS R5','Sony α7R V','Nikon Z8','Insta360 ONE RS 1-Inch'],
  hdriLenses: ['8mm Fisheye','12mm Fisheye','15mm Fisheye','14mm Rectilinear'],
  hdriBrackets: ['-4 / 0 / +4 EV','-6 / -3 / 0 / +3 / +6 EV','-8 ~ +8 EV'],
  hdriSteps: ['1 EV','2 EV','3 EV','4 EV'],
  hdriDirections: ['4방향','6방향','8방향','360 파노라마'],
  hdriCharts: ['크롬볼','그레이볼','Macbeth','크롬볼 + 그레이볼','전체'],
  keyStops: ['T1.4','T2','T2.8','T4','T5.6','T8','T11','T16'],
  keyDirections: ['12시','1시 30분','3시','4시 30분','6시','7시 30분','9시','10시 30분','Top','Bottom'],
  keySources: ['HMI','Tungsten','LED','형광등','실광','자연광','반사광','혼합광'],
  meterModes: ['Incident','Spot','False Color','Waveform','Light Meter + Camera'],
  lightColors: ['3200K','4300K','5600K','6500K','혼합','RGB'],
};

/* 레퍼런스 탭에 노출할 그룹 + 한글 라벨 */
export const REF_GROUPS = [
  { title:'씬 / 촬영', keys:{
      episodes:'에피소드', scenes:'씬', units:'유닛',
      intExt:'INT/EXT', tod:'시간대', statuses:'상태', vendors:'벤더' } },
  { title:'VFX', keys:{
      vfxA:'VFX A', vfxB:'VFX B', workElements:'작업 요소', taskStates:'작업 상태' } },
  { title:'로케이션', keys:{
      locations:'로케이션', setTypes:'세트 타입', scanOptions:'3D 스캔',
      hdriOptions:'HDRI', modelOptions:'3D 모델', seasons:'시즌' } },
  { title:'카메라', keys:{
      cameraManufacturers:'제조사', cameraModels:'모델', cameraBodies:'바디',
      cameraResolutions:'해상도', cameraFormats:'포맷', sensorModes:'센서 모드',
      lenses:'렌즈 시리즈', focalLengths:'초점거리', tStops:'T-Stop',
      isoEi:'ISO/EI', shutters:'셔터', whiteBalance:'화이트밸런스' } },
  { title:'에셋', keys:{
      assetTypes:'에셋 타입', propMethods:'프랍 방식', lidarOptions:'LiDAR', assetMaterials:'재질' } },
  { title:'HDRI / 조명', keys:{
      hdriCameras:'HDRI 카메라', hdriLenses:'HDRI 렌즈', hdriBrackets:'브라케팅',
      hdriSteps:'EV 스텝', hdriDirections:'촬영 방향', hdriCharts:'차트',
      keyStops:'키 스탑', keyDirections:'키 방향', keySources:'키 소스',
      meterModes:'측광 방식', lightColors:'광원 색온도' } },
  { title:'딜리버리', keys:{
      deliveryResolutions:'해상도', deliveryAspects:'화면비', fps:'FPS',
      colorSpaces:'컬러스페이스', bitDepths:'비트뎁스', codecs:'코덱', containers:'컨테이너' } },
];

/* ---------- 프로젝트 (단일 레코드) ---------- */
export const PROJECT_SCHEMA = {
  groups: [
    { title:'기본 정보', fields:[
      { k:'poster', label:'포스터', t:'photo' },
      { k:'name', label:'프로젝트명', t:'text' },
      { k:'type', label:'구분', t:'text' },
      { k:'crankIn', label:'크랭크인', t:'date' },
      { k:'crankUp', label:'크랭크업', t:'date' },
      { k:'deliveryDate', label:'납품일', t:'date' },
      { k:'productionCompany', label:'제작사', t:'text' },
      { k:'distributor', label:'배급/편성', t:'text' },
      { k:'mainSchedule', label:'주요 일정', t:'textarea' },
    ]},
    { title:'주요 스태프', fields:[
      { k:'director', label:'감독', t:'text' },
      { k:'bDirector', label:'B팀 감독', t:'text' },
      { k:'cinematographer', label:'촬영감독', t:'text' },
      { k:'productionDesigner', label:'미술감독', t:'text' },
      { k:'gaffer', label:'조명감독', t:'text' },
      { k:'producer', label:'프로듀서', t:'text' },
      { k:'assistantDirector', label:'조감독', t:'text' },
    ]},
    { title:'딜리버리 스펙', fields:[
      { k:'deliveryResolution', label:'해상도', t:'combo', ref:'deliveryResolutions' },
      { k:'deliveryAspect', label:'화면비', t:'combo', ref:'deliveryAspects' },
      { k:'deliveryFps', label:'FPS', t:'combo', ref:'fps' },
      { k:'deliveryColorSpace', label:'컬러스페이스', t:'combo', ref:'colorSpaces' },
      { k:'deliveryBitDepth', label:'비트뎁스', t:'combo', ref:'bitDepths' },
      { k:'deliveryCodec', label:'코덱', t:'combo', ref:'codecs' },
      { k:'deliveryContainer', label:'컨테이너', t:'combo', ref:'containers' },
      { k:'deliveryAudio', label:'오디오', t:'text' },
      { k:'deliveryHandles', label:'핸들', t:'text' },
      { k:'deliveryNaming', label:'네이밍 규칙', t:'text' },
      { k:'deliveryNotes', label:'비고', t:'textarea' },
    ]},
  ]
};

/* ---------- 엔티티 ---------- */
export const ENTITIES = {

  /* ============ 씬 (기록 단위) ============ */
  scenes: {
    label: '씬', icon: '◧', store: 'scenes',
    idPrefix: null,                 // 프로젝트명 약어 기반 (예: PMT-20260807-181959-4E54)
    titleFields: ['episode','scene'],
    subtitleFields: ['location','subLocation'],
    thumbField: 'thumbnail',
    inherit: ['episode','scene','unit','intExt','tod','location','subLocation','vendor','status','project'],
    autoStamp: { date:'shootDate', time:'shootTime' },
    filters: [
      { k:'episode', ref:'episodes', label:'EP' },
      { k:'scene',   ref:'scenes',   label:'씬' },
      { k:'status',  ref:'statuses', label:'상태' },
      { k:'vendor',  ref:'vendors',  label:'벤더' },
      { k:'vfxA',    ref:'vfxA',     label:'VFX A' },
    ],
    listCols: ['episode','scene','intExt','tod','location','vfxA','status'],
    csvCols: ['id','project','episode','scene','shootDate','shootTime','unit',
              'intExt','tod','location','subLocation','script','shotNote','vfxA','vfxB',
              'workElement','status','vendor','filename','extraNote','penNote','createdAt','updatedAt'],
    groups: [
      { title:'식별', fields:[
        { k:'thumbnail', label:'대표 이미지', t:'photo' },
        { k:'episode', label:'에피소드', t:'combo', ref:'episodes' },
        { k:'scene',   label:'씬',       t:'combo', ref:'scenes' },
        { k:'unit',    label:'유닛',     t:'combo', ref:'units' },
        { k:'shootDate', label:'촬영일', t:'date' },
        { k:'shootTime', label:'촬영시각', t:'time' },
      ]},
      { title:'공간', fields:[
        { k:'intExt', label:'INT/EXT', t:'select', ref:'intExt' },
        { k:'tod',    label:'시간대',   t:'select', ref:'tod' },
        { k:'location', label:'로케이션', t:'combo', ref:'locations' },
        { k:'subLocation', label:'세부 장소', t:'text' },
      ]},
      { title:'내용', fields:[
        { k:'script',   label:'대본/지문', t:'textarea', full:true },
        { k:'shotNote', label:'샷 노트',   t:'textarea', full:true },
      ]},
      { title:'VFX', fields:[
        { k:'vfxA', label:'VFX A', t:'combo', ref:'vfxA' },
        { k:'vfxB', label:'VFX B', t:'combo', ref:'vfxB' },
        { k:'workElement', label:'작업 요소', t:'combo', ref:'workElements' },
        { k:'status', label:'상태', t:'select', ref:'statuses' },
        { k:'vendor', label:'벤더', t:'combo', ref:'vendors' },
        { k:'filename', label:'파일명', t:'text' },
      ]},
      { title:'현장 사진', fields:[
        { k:'photos', label:'현장 사진', t:'photos', n:3, full:true },
      ]},
      { title:'메모', fields:[
        { k:'extraNote', label:'추가 메모', t:'textarea', full:true },
        { k:'penNote',   label:'수기 메모', t:'textarea', full:true },
      ]},
    ],
  },

  /* ============ 로케이션 ============ */
  locations: {
    label:'로케이션', icon:'◈', store:'locations', idPrefix:'LOC',
    titleFields:['shootLocation'], subtitleFields:['setId','path'],
    thumbField:'thumbnail',
    filters:[
      { k:'setType', ref:'setTypes', label:'세트 타입' },
      { k:'intExt',  ref:'intExt',   label:'INT/EXT' },
      { k:'scan3d',  ref:'scanOptions', label:'3D 스캔' },
      { k:'hdri',    ref:'hdriOptions', label:'HDRI' },
    ],
    listCols:['setId','shootLocation','setType','intExt','scan3d','hdri','model3d'],
    csvCols:['id','setId','shootLocation','setType','mainLocation','subLocation','intExt',
             'scan3d','hdri','model3d','seasonStart','seasonEnd','path','description',
             'elements3d','usedCuts','createdAt','updatedAt'],
    groups:[
      { title:'식별', fields:[
        { k:'thumbnail', label:'대표 이미지', t:'photo' },
        { k:'setId', label:'세트 ID', t:'text' },
        { k:'shootLocation', label:'촬영 장소', t:'combo', ref:'locations' },
        { k:'setType', label:'세트 타입', t:'select', ref:'setTypes' },
        { k:'intExt', label:'INT/EXT', t:'select', ref:'intExt' },
        { k:'mainLocation', label:'메인 로케이션', t:'text' },
        { k:'subLocation', label:'서브 로케이션', t:'text' },
        { k:'path', label:'주소 / 경로', t:'text' },
      ]},
      { title:'데이터 취득', fields:[
        { k:'scan3d',  label:'3D 스캔', t:'select', ref:'scanOptions' },
        { k:'hdri',    label:'HDRI',    t:'select', ref:'hdriOptions' },
        { k:'model3d', label:'3D 모델', t:'select', ref:'modelOptions' },
        { k:'seasonStart', label:'시즌 시작', t:'select', ref:'seasons' },
        { k:'seasonEnd',   label:'시즌 종료', t:'select', ref:'seasons' },
      ]},
      { title:'내용', fields:[
        { k:'description', label:'설명', t:'textarea', full:true },
        { k:'elements3d',  label:'3D 요소', t:'textarea', full:true },
        { k:'usedCuts',    label:'사용 컷', t:'text', full:true },
      ]},
      { title:'사진', fields:[
        { k:'conceptPhotos',  label:'컨셉',   t:'photos', n:2, full:true },
        { k:'surveyPhotos',   label:'서베이', t:'photos', n:2, full:true },
        { k:'locationPhotos', label:'현장',   t:'photos', n:2, full:true },
      ]},
    ],
  },

  /* ============ 카메라 ============ */
  cameras: {
    label:'카메라', icon:'◎', store:'cameras', idPrefix:'CAM',
    titleFields:['name'], subtitleFields:['camRoll','lensSeries'],
    thumbField:'photo',
    filters:[
      { k:'manufacturer', ref:'cameraManufacturers', label:'제조사' },
      { k:'resolution',   ref:'cameraResolutions',   label:'해상도' },
    ],
    listCols:['camRoll','manufacturer','name','resolution','format','sensorMode','lensSeries'],
    csvCols:['id','camRoll','manufacturer','name','detailModel','resolution','aperture',
             'format','sensorMode','lensSeries','lensSet','notes','createdAt','updatedAt'],
    groups:[
      { title:'바디', fields:[
        { k:'photo', label:'사진', t:'photo' },
        { k:'camRoll', label:'카메라 롤', t:'text' },
        { k:'manufacturer', label:'제조사', t:'combo', ref:'cameraManufacturers' },
        { k:'name', label:'모델', t:'combo', ref:'cameraModels' },
        { k:'detailModel', label:'세부 모델', t:'text' },
        { k:'resolution', label:'해상도', t:'combo', ref:'cameraResolutions' },
        { k:'format', label:'포맷', t:'combo', ref:'cameraFormats' },
        { k:'sensorMode', label:'센서 모드', t:'combo', ref:'sensorModes' },
      ]},
      { title:'렌즈', fields:[
        { k:'lensSeries', label:'렌즈 시리즈', t:'combo', ref:'lenses' },
        { k:'lensSet', label:'렌즈 세트', t:'text' },
        { k:'aperture', label:'조리개', t:'combo', ref:'tStops' },
      ]},
      { title:'메모', fields:[
        { k:'notes', label:'비고', t:'textarea', full:true },
      ]},
    ],
  },

  /* ============ 에셋 ============ */
  assets: {
    label:'에셋', icon:'◇', store:'assets', idPrefix:'AST',
    titleFields:['name'], subtitleFields:['assetId','type'],
    thumbField:'thumbnail',
    filters:[
      { k:'type', ref:'assetTypes', label:'타입' },
      { k:'propMethod', ref:'propMethods', label:'프랍 방식' },
      { k:'lidar', ref:'lidarOptions', label:'LiDAR' },
      { k:'model3d', ref:'modelOptions', label:'3D 모델' },
    ],
    listCols:['assetId','name','type','propMethod','lidar','hdri','model3d'],
    csvCols:['id','assetId','name','type','propMethod','lidar','hdri','model3d',
             'description','memo','path','createdAt','updatedAt'],
    groups:[
      { title:'식별', fields:[
        { k:'thumbnail', label:'대표 이미지', t:'photo' },
        { k:'assetId', label:'에셋 ID', t:'text' },
        { k:'name', label:'이름', t:'text' },
        { k:'type', label:'타입', t:'select', ref:'assetTypes' },
        { k:'material', label:'재질', t:'combo', ref:'assetMaterials' },
        { k:'path', label:'경로', t:'text' },
      ]},
      { title:'데이터 취득', fields:[
        { k:'propMethod', label:'프랍 방식', t:'select', ref:'propMethods' },
        { k:'lidar',   label:'LiDAR',   t:'select', ref:'lidarOptions' },
        { k:'hdri',    label:'HDRI',    t:'select', ref:'hdriOptions' },
        { k:'model3d', label:'3D 모델', t:'select', ref:'modelOptions' },
      ]},
      { title:'내용', fields:[
        { k:'description', label:'설명', t:'textarea', full:true },
        { k:'memo', label:'메모', t:'textarea', full:true },
        { k:'linkedSceneIds', label:'연결 씬', t:'link', to:'scenes', full:true },
      ]},
      { title:'사진', fields:[
        { k:'imagePhotos',  label:'이미지',  t:'photos', n:2, full:true },
        { k:'surveyPhotos', label:'서베이',  t:'photos', n:2, full:true },
        { k:'platePhotos',  label:'플레이트', t:'photos', n:2, full:true },
      ]},
    ],
  },

  /* ============ HDRI / 조명 (신규) ============ */
  hdri: {
    label:'HDRI·조명', icon:'◐', store:'hdri', idPrefix:'HDR',
    titleFields:['hdriId','location'], subtitleFields:['shootDate','tod'],
    thumbField:'thumbnail',
    inherit:['location','intExt','tod','camera','lens','brackets','evStep','directions','chart'],
    autoStamp:{ date:'shootDate', time:'shootTime' },
    filters:[
      { k:'location', ref:'locations', label:'로케이션' },
      { k:'tod', ref:'tod', label:'시간대' },
      { k:'chart', ref:'hdriCharts', label:'차트' },
      { k:'keySource', ref:'keySources', label:'키 소스' },
    ],
    listCols:['hdriId','shootDate','shootTime','location','intExt','tod','camera','brackets','keyStop','keySource'],
    csvCols:['id','hdriId','shootDate','shootTime','location','subLocation','intExt','tod',
             'linkedScene','camera','lens','brackets','evStep','directions','chart',
             'iso','shutter','wb','tStop','keyStop','keyDirection','keySource','meterMode',
             'lightColor','ambientStop','ratio','notes','createdAt','updatedAt'],
    groups:[
      { title:'식별', fields:[
        { k:'thumbnail', label:'대표 이미지', t:'photo' },
        { k:'hdriId', label:'HDRI ID', t:'text' },
        { k:'shootDate', label:'촬영일', t:'date' },
        { k:'shootTime', label:'촬영시각', t:'time' },
        { k:'location', label:'로케이션', t:'combo', ref:'locations' },
        { k:'subLocation', label:'세부 장소', t:'text' },
        { k:'intExt', label:'INT/EXT', t:'select', ref:'intExt' },
        { k:'tod', label:'시간대', t:'select', ref:'tod' },
        { k:'linkedScene', label:'연결 씬', t:'link', to:'scenes', full:true },
      ]},
      { title:'HDRI 촬영 스펙', fields:[
        { k:'camera', label:'카메라', t:'combo', ref:'hdriCameras' },
        { k:'lens', label:'렌즈', t:'combo', ref:'hdriLenses' },
        { k:'brackets', label:'브라케팅', t:'combo', ref:'hdriBrackets' },
        { k:'evStep', label:'EV 스텝', t:'combo', ref:'hdriSteps' },
        { k:'directions', label:'촬영 방향', t:'combo', ref:'hdriDirections' },
        { k:'chart', label:'차트', t:'combo', ref:'hdriCharts' },
        { k:'iso', label:'ISO/EI', t:'combo', ref:'isoEi' },
        { k:'shutter', label:'셔터', t:'combo', ref:'shutters' },
        { k:'wb', label:'화이트밸런스', t:'combo', ref:'whiteBalance' },
        { k:'tStop', label:'T-Stop', t:'combo', ref:'tStops' },
      ]},
      { title:'조명 측정', fields:[
        { k:'keyStop', label:'키 스탑', t:'combo', ref:'keyStops' },
        { k:'keyDirection', label:'키 방향', t:'combo', ref:'keyDirections' },
        { k:'keySource', label:'키 소스', t:'combo', ref:'keySources' },
        { k:'meterMode', label:'측광 방식', t:'combo', ref:'meterModes' },
        { k:'lightColor', label:'광원 색온도', t:'combo', ref:'lightColors' },
        { k:'ambientStop', label:'앰비언트 스탑', t:'combo', ref:'keyStops' },
        { k:'ratio', label:'키:필 비율', t:'text' },
      ]},
      { title:'사진 / 메모', fields:[
        { k:'hdriPhotos', label:'HDRI 소스', t:'photos', n:4, full:true },
        { k:'chartPhotos', label:'차트 / 볼', t:'photos', n:2, full:true },
        { k:'notes', label:'비고', t:'textarea', full:true },
      ]},
    ],
  },
};

export const ENTITY_ORDER = ['scenes','locations','hdri','assets','cameras'];

/* 편의: 엔티티의 모든 필드를 flat 하게 */
export function allFields(ent){
  return ENTITIES[ent].groups.flatMap(g => g.fields);
}
export function fieldMap(ent){
  const m = {}; for (const f of allFields(ent)) m[f.k] = f; return m;
}
export function labelOf(ent, key){
  const f = fieldMap(ent)[key];
  return f ? f.label : key;
}
