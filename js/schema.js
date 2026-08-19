/* =====================================================================
 * Ribi Onset — schema.js
 * 모든 엔티티/필드/레퍼런스를 여기서만 선언한다.
 * 필드를 추가·삭제·순서변경 하려면 이 파일만 고치면 UI/CSV/PDF가 따라온다.
 *
 * 계층
 *   Project ─┬─ Scene ── Cut ── Take[]   (촬영 기록 / VFX 물량)
 *            ├─ Location
 *            ├─ Asset
 *            ├─ Camera
 *            └─ HDRI
 *
 * 필드 타입
 *   text      단일행 텍스트
 *   textarea  여러행 텍스트
 *   date / time
 *   combo     레퍼런스 목록 + 자유 입력 (없는 값은 레퍼런스에 자동 편입)
 *   select    레퍼런스 목록에서만 선택
 *   seg       2~4개 선택지 세그먼트 버튼
 *   photo     이미지 1장 (탭하면 바로 카메라)
 *   photos    이미지 N장 (n 속성, perRow 로 한 줄 개수 지정)
 *   link      다른 엔티티 레코드 다중 연결 (to 속성)
 *   sketch    S펜/손가락 필기 캔버스 → PNG 로 저장
 *   backlink  반대편에서 연결한 결과를 읽기 전용으로 표시 (from / via 속성)
 *   recordRef 다른 엔티티 레코드 1개를 고른다 (to 속성, id 를 저장)
 *
 * 엔티티에 inline:true 를 주면 상세 페이지 없이 리스트에서 바로 편집한다.
 * 이때 화면에 나올 항목/순서는 inlineFields 로 정한다.
 *
 * 배치
 *   그룹에 cols:N 을 주면 N열 고정 격자가 되고, 필드의 span / rowSpan 으로
 *   칸을 차지한다. 좁은 화면에서는 자동으로 흐름 배치로 되돌아간다.
 *   cols 가 없으면 기존처럼 폭에 맞춰 자동 배치된다.
 * ===================================================================== */

/** 화면에 표시할 빌드 표기. sw.js 의 SHELL_VER 와 함께 올린다. */
export const BUILD = 'v34 · 2026-08-13';

/* ---------- 기본 레퍼런스 ---------- */
export const DEFAULT_REFS = {
  episodes: Array.from({length:12},(_,i)=>'EP'+String(i+1).padStart(2,'0')),
  scenes: ['1-1','2-1'],
  cutNos: ['1','2','3','4','5','6','7','8','A','B','C'],
  units: ['A','B','C'],
  framings: ['F.S','L.S','K.S','W.S','M.S','B.S','C.U','B.C.U','E.C.U','2S','O.S','인서트','P.O.V','드론'],
  intExt: ['INT','EXT','INT/EXT'],
  tod: ['DAY','NIGHT','DAWN','DUSK','SUNRISE','SUNSET'],

  /* VFX 통계 축 — Overview 집계는 이 값으로만 센다 */
  vfxTypes: ['2D','3D','AI','COMP','MATTE PAINT','PREP'],
  workElements: ['wire removal','clean up','green screen','set extension','crowd',
                 'muzzle flash','blood','monitor','sky replace','face fix','creature',
                 'vehicle','environment','beauty','2D retouch'],
  vendors: ['WSWG','HI','4D','미정'],
  takeStates: ['OK','KEEP','NG'],

  projectTypes: ['영화','드라마'],
  setTypes: ['Location','Set','Partial Set','Studio','Virtual Production'],
  scanOptions: ['미정','불필요','LiDAR','Photogrammetry','Hand 3D scan','촬영완료'],

  cameraManufacturers: ['ARRI','SONY','RED','BLACKMAGIC','CANON'],
  cameraModels: ['ARRI ALEXA 35','ARRI ALEXA Mini LF','ARRI ALEXA Mini','Sony VENICE 2','RED V-RAPTOR'],
  cameraResolutions: ['2.8K','3.2K','4K','4.6K','6K','8K','3840'],
  cameraFormats: ['ARRIRAW','ProRes 4444 XQ','X-OCN ST','REDCODE RAW','BRAW'],
  sensorModes: ['Open Gate','4.6K 16:9','LF Open Gate','6K 3:2','8K FF'],
  lenses: ['ARRI Signature Prime','Cooke S7/i','Cooke Panchro/i','Zeiss Supreme Prime','Angenieux Optimo'],
  camRolls: ['A','B','C','D'],

  deliveryResolutions: ['1920×1080','2048×1080','3840×2160','4096×2160'],
  deliveryAspects: ['16:9','1.85:1','1.90:1','2.00:1','2.39:1'],
  fps: ['23.976','24','25','29.97','30','48','50','59.94','60','96','120'],
  colorSpaces: ['ACEScg','ACES2065-1','Rec.709','P3-D65','DCI-P3','LogC4','LogC3','S-Gamut3.Cine'],
  bitDepths: ['10-bit','12-bit','16-bit half','16-bit integer','32-bit float'],
  codecs: ['OpenEXR ZIP','OpenEXR DWAA','ProRes 4444 XQ','ProRes 422 HQ','DNxHR HQX','H.264'],
  containers: ['EXR Sequence','MOV','MXF','DPX Sequence','TIFF Sequence'],

  assetTypes: ['캐릭터','프랍','차량','환경'],
  hdriOptions: ['None','필요','촬영완료'],
  modelOptions: ['None','제작 필요','기존 모델','제작완료'],

  locations: [],
  focalLengths: ['18mm','21mm','24mm','27mm','32mm','35mm','40mm','50mm','65mm','75mm','85mm','100mm','135mm'],
  tStops: ['T1.4','T2','T2.8','T4','T5.6','T8','T11','T16'],
  isoEi: ['EI 400','EI 640','EI 800','EI 1280','EI 1600','EI 2500'],
  shutters: ['11.25°','22.5°','45°','90°','144°','172.8°','180°','270°','360°'],
  whiteBalance: ['3200K','4300K','5600K','6500K','Custom'],
  ndFilters: ['-','ND0.3','ND0.6','ND0.9','ND1.2','ND1.5','ND1.8','ND2.1'],

  hdriCameras: ['Canon EOS R5','Sony α7R V','Nikon Z8','Insta360 ONE RS 1-Inch','RICOH THETA'],
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

/* Setting 탭에 노출할 그룹 */
export const REF_GROUPS = [
  { title:'Scene / Cut', keys:{
      episodes:'에피소드 (드라마)', cutNos:'컷 번호', units:'유닛',
      framings:'사이즈 / 앵글',
      intExt:'INT/EXT', tod:'시간대', takeStates:'테이크 판정' } },
  { title:'VFX', keys:{
      vfxTypes:'작업 타입 (통계 축)', workElements:'작업 요소', vendors:'벤더' } },
  { title:'Location', keys:{
      locations:'로케이션', setTypes:'세트 타입', scanOptions:'3D 스캔', hdriOptions:'HDRI' } },
  { title:'Camera', keys:{
      cameraManufacturers:'제조사', cameraModels:'모델', camRolls:'캠 롤',
      cameraResolutions:'해상도', cameraFormats:'포맷', sensorModes:'센서 모드',
      lenses:'렌즈 시리즈', focalLengths:'초점거리', tStops:'T-Stop',
      isoEi:'ISO/EI', shutters:'셔터', whiteBalance:'화이트밸런스', ndFilters:'ND' } },
  { title:'Asset', keys:{
      assetTypes:'에셋 타입', modelOptions:'3D 모델' } },
  { title:'HDRI / Light', keys:{
      hdriCameras:'HDRI 카메라', hdriLenses:'HDRI 렌즈', hdriBrackets:'브라케팅',
      hdriSteps:'EV 스텝', hdriDirections:'촬영 방향', hdriCharts:'차트',
      keyStops:'키 스탑', keyDirections:'키 방향', keySources:'키 소스',
      meterModes:'측광 방식', lightColors:'광원 색온도' } },
  { title:'Delivery', keys:{
      deliveryResolutions:'해상도', deliveryAspects:'화면비', fps:'FPS',
      colorSpaces:'컬러스페이스', bitDepths:'비트뎁스', codecs:'코덱', containers:'컨테이너' } },
];

/* ---------- 프로젝트 ---------- */
export const PROJECT_SCHEMA = {
  groups: [
    { title:'PROJECT OVERVIEW · 기본정보', fields:[
      { k:'poster', label:'프로젝트 이미지', t:'photo', preset:'thumb', full:true },
      { k:'type', label:'구분', t:'seg', ref:'projectTypes' },
      { k:'name', label:'프로젝트명', t:'text' },
      { k:'season', label:'시즌 / 파트', t:'text' },
      { k:'episodeCount', label:'총 회차', t:'text' },
      { k:'crankIn', label:'크랭크인', t:'date' },
      { k:'crankUp', label:'크랭크업', t:'date' },
      { k:'deliveryDate', label:'납품일', t:'date' },
      { k:'productionCompany', label:'제작사', t:'text' },
      { k:'distributor', label:'배급사 / 플랫폼', t:'text' },
      { k:'mainSchedule', label:'주요 일정', t:'textarea', full:true },
    ]},
    { title:'KEY STAFF · 키스탭', fields:[
      { k:'director', label:'감독', t:'text' },
      { k:'cinematographer', label:'촬영감독', t:'text' },
      { k:'productionDesigner', label:'미술감독', t:'text' },
      { k:'gaffer', label:'조명감독', t:'text' },
      { k:'producer', label:'PD', t:'text' },
      { k:'assistantDirector', label:'조감독', t:'text' },
      { k:'bDirector', label:'B감독', t:'text' },
      { k:'vfxSupervisor', label:'VFX 슈퍼바이저', t:'text' },
      { k:'aiSupervisor', label:'AI 슈퍼바이저', t:'text' },
      { k:'vfxAssist', label:'VFX 어시스트', t:'text' },
    ]},
    { title:'DELIVERY SPEC · 딜리버리 스펙', fields:[
      { k:'deliveryResolution', label:'해상도', t:'combo', ref:'deliveryResolutions' },
      { k:'deliveryAspect', label:'화면비', t:'combo', ref:'deliveryAspects' },
      { k:'deliveryFps', label:'FPS', t:'combo', ref:'fps' },
      { k:'deliveryColorSpace', label:'컬러스페이스', t:'combo', ref:'colorSpaces' },
      { k:'workColorSpace', label:'작업 컬러스페이스', t:'combo', ref:'colorSpaces' },
      { k:'onsetLut', label:'온셋 LUT', t:'text' },
      { k:'deliveryBitDepth', label:'비트뎁스', t:'combo', ref:'bitDepths' },
      { k:'deliveryCodec', label:'코덱', t:'combo', ref:'codecs' },
      { k:'deliveryContainer', label:'컨테이너', t:'combo', ref:'containers' },
      { k:'deliveryAudio', label:'오디오', t:'text' },
      { k:'deliveryHandles', label:'핸들', t:'text' },
      { k:'deliveryNaming', label:'네이밍 규칙', t:'text' },
      { k:'deliveryNotes', label:'납품 메모', t:'textarea', full:true },
    ]},
  ]
};

/* ---------- 테이크 (컷 안에 배열로 들어감) ---------- */
export const TAKE_FIELDS = [
  { k:'takeNo',  label:'테이크', t:'text',   w:'60px' },
  { k:'camRoll', label:'캠 롤',  t:'combo',  ref:'camRolls', w:'80px' },
  { k:'clip',    label:'클립',   t:'text',   w:'80px' },
  { k:'tc',      label:'TC',     t:'text',   w:'110px' },
  { k:'state',   label:'판정',   t:'select', ref:'takeStates', w:'80px' },
  { k:'fps',     label:'FPS',    t:'combo',  ref:'fps', w:'80px' },
  { k:'shutter', label:'셔터',   t:'combo',  ref:'shutters', w:'85px' },
  { k:'iris',    label:'IRIS',   t:'combo',  ref:'tStops', w:'80px' },
  { k:'ei',      label:'EI',     t:'combo',  ref:'isoEi', w:'85px' },
  { k:'nd',      label:'ND',     t:'combo',  ref:'ndFilters', w:'80px' },
  { k:'wb',      label:'WB',     t:'combo',  ref:'whiteBalance', w:'85px' },
  { k:'lens',    label:'렌즈',   t:'combo',  ref:'focalLengths', w:'85px' },
  { k:'note',    label:'노트',   t:'text',   w:'1fr' },
];

/* ---------- 엔티티 ---------- */
export const ENTITIES = {

  /* ============ SCENE — 현장 기록 단위 ============
     한 씬 안에서 카메라(A~D)를 탭으로 나눈다.
     cam:true 인 필드만 탭에 따라 값이 바뀌고(rec.cams[탭][키] 에 저장),
     나머지(로케이션·시제·벤더 등)는 씬 전체가 공유한다. */
  scenes: {
    label:'Scene', labelKo:'씬', title:'Scene List',
    desc:'씬 단위로 기록하고, 카메라별로 캠 롤·클립·모니터 사진을 남깁니다.',
    icon:'◧', store:'scenes', idPrefix:null,
    cams:['A','B','C','D'],
    titleFields:['episode','scene'],
    subtitleFields:['intExt','tod'],
    thumbField:'thumbnail',
    inherit:['episode','unit','intExt','tod','locationId','vendor'],
    autoStamp:{ date:'shootDate', time:'shootTime' },
    filters:[
      { k:'episode', ref:'episodes', label:'EP', when:(p)=>p.type === '드라마' },
      { k:'unit',    ref:'units',    label:'유닛' },
      { k:'intExt',  ref:'intExt',   label:'INT/EXT' },
      { k:'tod',     ref:'tod',      label:'시제' },
      { k:'vendor',  ref:'vendors',  label:'벤더' },
    ],
    listCols:['episode','scene','__cams','__vfx','locationId','shotNote','vendor'],
    csvCols:['id','episode','scene','unit','shootDate','shootTime','intExt','tod',
             'locationId','vendor','shotNote','extraNote','createdAt','updatedAt'],
    groups:[
      /* 4열 고정 — 썸네일이 왼쪽에서 3행을 관통한다
         1행: 에피소드 · 씬 · 촬영유닛(캠별)  2행: 캠 롤 · 클립 · 로케이션
         3행: INT/EXT · 시제 · 벤더         4행: 촬영일 · 촬영시각 · 에셋 · 작업 타입 */
      { title:'기본정보', cols:4, fields:[
        // ocr:true → 사진 위의 ⌁ 버튼으로 모니터 오버레이를 읽어 캠 롤·클립을 채운다
        { k:'thumbnail', label:'모니터 / 대표 이미지', t:'photo', preset:'plate', span:1, rowSpan:3, cam:true, ocr:true },
        { k:'episode', label:'에피소드', t:'combo', ref:'episodes', span:1, when:(p)=>p.type === '드라마' },
        // 씬 번호는 프로젝트마다 수백 개가 되어 드롭다운으로는 못 찾는다 → 직접 입력
        { k:'scene',   label:'씬',       t:'text', span:1, hint:'예) 12-3' },
        // soft:true — 값이 있어도 "이 캠으로 찍었다"의 근거가 되지 않는다.
        // 유닛은 직전 씬에서 자동 상속되므로, 이걸로 세면 찍지도 않은 캠이 물량에 잡힌다.
        { k:'unit',    label:'촬영 유닛', t:'combo', ref:'units', span:1, cam:true, soft:true },
        { k:'camRoll', label:'캠 롤', t:'text', span:1, cam:true },
        { k:'clip',    label:'클립',  t:'text', span:1, cam:true },
        { k:'locationId', label:'로케이션', t:'recordRef', to:'locations', span:1 },
        { k:'intExt', label:'INT / EXT', t:'select', ref:'intExt', span:1 },
        { k:'tod',    label:'시제',      t:'select', ref:'tod', span:1 },
        { k:'vendor', label:'벤더',      t:'combo',  ref:'vendors', span:1 },
        { k:'shootDate', label:'촬영일',  t:'date', span:1 },
        { k:'shootTime', label:'촬영시각', t:'time', span:1 },
        { k:'linkedAssetIds', label:'에셋', t:'link', to:'assets', span:1 },
        // VFX 물량의 통계 축. 캠(앵글)마다 다르므로 캠별 값이다 —
        // A캠 와이드에는 set extension 이 필요해도 B캠 클로즈업엔 없을 수 있다.
        { k:'vfxType', label:'작업 타입', t:'select', ref:'vfxTypes', span:1, cam:true },
      ]},
      { title:'내용', fields:[
        { k:'shotNote',  label:'씬 노트', t:'textarea', full:true },
        { k:'extraNote', label:'메모',    t:'textarea', full:true },
        { k:'sketch',    label:'스케치 (S펜)', t:'sketch', full:true },
      ]},
      { title:'현장 사진', fields:[
        { k:'photos', label:'현장 사진', t:'photos', n:14, perRow:7, full:true, cam:true },
      ]},
    ],
  },

  /* ============ CUT — VFX 물량 단위 (씬의 자식) ============
     컷 = "한 카메라가 잡는 하나의 앵글".
     A/B캠이 동시에 다른 사이즈를 잡으면 그것은 서로 다른 컷이고,
     같은 순간이라는 사실은 slate(슬레이트 번호)를 공유해서 표현한다. */
  cuts: {
    label:'Cut', labelKo:'컷', icon:'▤', store:'cuts', idPrefix:'CUT',
    parent:'scenes', parentKey:'sceneId',
    titleFields:['cutNo'], subtitleFields:['vfxType','workElement'],
    thumbField:'thumbnail',
    inherit:['vfxType','vendor'],
    filters:[
      { k:'vfxType', ref:'vfxTypes', label:'타입' },
      { k:'vendor',  ref:'vendors',  label:'벤더' },
    ],
    listCols:['cutNo','camUnit','vfxType','workElement','vendor'],
    csvCols:['id','sceneId','episode','scene','cutNo','camUnit','slate','vfxShotId','vfxType','workElement',
             'vendor','takeCount','okTakes','shotNote','plateNote','createdAt','updatedAt'],
    groups:[
      { title:'식별', fields:[
        { k:'thumbnail', label:'컷 이미지', t:'photo', preset:'thumb' },
        { k:'cutNo',     label:'컷 번호', t:'combo', ref:'cutNos' },
        { k:'camUnit',   label:'캠',      t:'combo', ref:'camRolls', hint:'A캠 / B캠' },
        { k:'slate',     label:'슬레이트', t:'text',  hint:'동시 촬영끼리 같은 값' },
        { k:'framing',   label:'사이즈 / 앵글', t:'combo', ref:'framings' },
        { k:'vfxShotId', label:'VFX 샷 ID', t:'text', hint:'편집 확정 후 입력' },
      ]},
      { title:'VFX', fields:[
        { k:'vfxType',     label:'작업 타입', t:'select', ref:'vfxTypes' },
        { k:'workElement', label:'작업 요소', t:'combo',  ref:'workElements' },
        { k:'vendor',      label:'벤더',     t:'combo',  ref:'vendors' },
      ]},
      { title:'노트', fields:[
        { k:'shotNote',  label:'샷 노트',        t:'textarea', full:true },
        { k:'plateNote', label:'플레이트 / 데이터 요청', t:'textarea', full:true },
      ]},
      { title:'참고 사진', fields:[
        { k:'photos', label:'참고 사진', t:'photos', n:3, full:true },
      ]},
    ],
  },

  /* ============ LOCATION ============ */
  locations: {
    label:'Location', labelKo:'로케이션', title:'로케이션 정보', desc:'대장소·소장소와 세트 타입, 스캔·HDRI 진행상태, 현장 레퍼런스를 관리합니다.',
    icon:'◈', store:'locations', idPrefix:'LOC',
    // 다른 화면(씬 목록·HDRI·연결 드롭다운)에 한 줄로 나올 때의 표기.
    // SET ID 까지 붙으면 목록에서 너무 길어진다 — Location 페이지 자체 목록에는 그대로 나온다.
    // 한 줄 표기는 '그린힐테라스/거실' — 목록 폭을 아끼려고 구분자를 슬래시로 붙인다
    titleFields:['mainLocation'], subtitleFields:['subLocation'], nameSep:'/',
    thumbField:'thumbnail',
    filters:[
      { k:'setType', ref:'setTypes', label:'세트 타입' },
      { k:'intExt',  ref:'intExt',   label:'INT/EXT' },
      { k:'scan3d',  ref:'scanOptions', label:'3D 스캔' },
      { k:'hdri',    ref:'hdriOptions', label:'HDRI' },
    ],
    listCols:['mainLocation','subLocation','setId','setType','intExt','description'],
    csvCols:['id','mainLocation','subLocation','setId','setType','intExt',
             'scan3d','hdri','path','description','elements3d','usedCuts','createdAt','updatedAt'],
    groups:[
      /* 4열 고정 — 입력칸 폭을 모두 같게 맞춘다
         1행: 대장소 · 소장소 · SET ID   2행: 세트 타입 · INT/EXT   3행: 주소
         썸네일은 왼쪽에서 3행을 관통 */
      { title:'기본정보', cols:4, fields:[
        { k:'thumbnail', label:'대표 이미지', t:'photo', preset:'thumb', span:1, rowSpan:3 },
        { k:'mainLocation', label:'대장소', t:'combo', ref:'locations', span:1 },
        { k:'subLocation',  label:'소장소', t:'text', span:1 },
        { k:'setId',        label:'SET ID', t:'text', span:1 },
        { k:'setType', label:'세트 타입', t:'select', ref:'setTypes', span:1 },
        { k:'intExt',  label:'INT / EXT', t:'select', ref:'intExt', span:1 },
        { k:'path',    label:'주소', t:'text', span:3 },
      ]},
      { title:'데이터 취득', fields:[
        { k:'scan3d',  label:'3D 스캔', t:'select', ref:'scanOptions' },
        { k:'hdri',    label:'HDRI',    t:'select', ref:'hdriOptions' },
      ]},
      { title:'내용', fields:[
        { k:'description', label:'설명', t:'textarea', full:true },
        { k:'elements3d',  label:'3D 요소', t:'textarea', full:true },
        { k:'usedCuts',    label:'사용 컷', t:'text', full:true },
        { k:'sketch',      label:'현장 스케치 (S펜)', t:'sketch', full:true },
      ]},
      { title:'사진', fields:[
        { k:'conceptPhotos',  label:'컨셉',  t:'photos', n:7, full:true },
        { k:'locationPhotos', label:'현장',  t:'photos', n:7, full:true },
      ]},
    ],
  },

  /* ============ ASSET ============ */
  assets: {
    label:'Asset', labelKo:'에셋', title:'에셋 정보', desc:'캐릭터·프랍·차량·환경 등 3D 제작 대상과 소스 사진을 관리합니다.',
    icon:'◇', store:'assets', idPrefix:'AST',
    titleFields:['name'], subtitleFields:['assetId','type'],
    thumbField:'thumbnail',
    filters:[
      { k:'type', ref:'assetTypes', label:'타입' },
    ],
    listCols:['assetId','name','type','description'],
    csvCols:['id','assetId','name','type','description','linkedScenes','createdAt','updatedAt'],
    groups:[
      { title:'기본정보', cols:4, fields:[
        { k:'thumbnail', label:'대표 이미지', t:'photo', preset:'thumb', span:1, rowSpan:2 },
        { k:'assetId', label:'에셋 ID', t:'text', span:1 },
        { k:'name',    label:'이름',     t:'text', span:1 },
        { k:'type',    label:'타입',     t:'select', ref:'assetTypes', span:1 },
      ]},
      { title:'내용', fields:[
        { k:'description', label:'설명', t:'textarea', full:true },
        // 씬에서 에셋을 연결하면 여기에 자동으로 쌓인다 (직접 편집하지 않음)
        { k:'linkedSceneIds', label:'연결 씬', t:'backlink', from:'scenes', via:'linkedAssetIds', full:true },
        { k:'sketch', label:'스케치 (S펜)', t:'sketch', full:true },
      ]},
      { title:'소스 사진', fields:[
        { k:'sourcePhotos', label:'소스', t:'photos', n:21, perRow:7, preset:'plate', full:true },
      ]},
    ],
  },

  /* ============ CAMERA ============ */
  /* inline:true → 상세 페이지 없이 리스트에서 바로 편집한다.
     장비는 항목 수가 적고 한눈에 비교하는 게 중요해서 목록형이 낫다. */
  cameras: {
    label:'Camera', labelKo:'카메라', title:'카메라 정보', desc:'바디·포맷·렌즈 등 촬영 장비 사양을 목록에서 바로 입력합니다.',
    icon:'◎', store:'cameras', idPrefix:'CAM',
    inline: true,
    titleFields:['name'], subtitleFields:['camRoll'],
    thumbField:'photo',
    filters:[
      { k:'manufacturer', ref:'cameraManufacturers', label:'제조사' },
      { k:'resolution',   ref:'cameraResolutions',   label:'해상도' },
    ],
    listCols:['camRoll','manufacturer','name','resolution','format','sensorMode','lensSeries'],
    csvCols:['id','camRoll','manufacturer','name','detailModel','resolution','aperture',
             'format','sensorMode','lensSeries','lensSet','notes','createdAt','updatedAt'],
    /* 리스트에서 두 칸씩 짝지어 보여줄 순서 */
    inlineFields:[
      { k:'camRoll',      label:'Cam Roll',    t:'combo',  ref:'camRolls' },
      { k:'name',         label:'카메라 이름',  t:'combo',  ref:'cameraModels' },
      { k:'manufacturer', label:'카메라 기종',  t:'combo',  ref:'cameraManufacturers' },
      { k:'detailModel',  label:'세부 기종',    t:'text' },
      { k:'resolution',   label:'Resolution',  t:'combo',  ref:'cameraResolutions' },
      { k:'aperture',     label:'Aperture',    t:'combo',  ref:'tStops' },
      { k:'format',       label:'포맷',        t:'combo',  ref:'cameraFormats' },
      { k:'sensorMode',   label:'센서 모드',    t:'combo',  ref:'sensorModes' },
      { k:'lensSeries',   label:'카메라 렌즈',  t:'combo',  ref:'lenses' },
      { k:'lensSet',      label:'렌즈군',      t:'textarea' },
      { k:'notes',        label:'비고',        t:'textarea', full:true },
    ],
    groups:[
      { title:'바디', fields:[
        { k:'photo', label:'사진', t:'photo', preset:'thumb' },
        { k:'camRoll', label:'카메라 롤', t:'combo', ref:'camRolls' },
        { k:'manufacturer', label:'제조사', t:'combo', ref:'cameraManufacturers' },
        { k:'name', label:'모델', t:'combo', ref:'cameraModels' },
        { k:'detailModel', label:'세부 모델', t:'text' },
        { k:'resolution', label:'해상도', t:'combo', ref:'cameraResolutions' },
        { k:'format', label:'포맷', t:'combo', ref:'cameraFormats' },
        { k:'sensorMode', label:'센서 모드', t:'combo', ref:'sensorModes' },
      ]},
      { title:'렌즈', fields:[
        { k:'lensSeries', label:'렌즈 시리즈', t:'combo', ref:'lenses' },
        { k:'lensSet', label:'렌즈 세트', t:'textarea' },
        { k:'aperture', label:'조리개', t:'combo', ref:'tStops' },
      ]},
      { title:'메모', fields:[
        { k:'notes', label:'비고', t:'textarea', full:true },
      ]},
    ],
  },

  /* ============ HDRI ============ */
  hdri: {
    label:'HDRI', labelKo:'HDRI', title:'HDRI 정보', desc:'HDRI 촬영 스펙과 현장 조명 측정값을 기록합니다.',
    icon:'◐', store:'hdri', idPrefix:'HDR',
    titleFields:['hdriId'], subtitleFields:['intExt','tod'],
    thumbField:'thumbnail',
    inherit:['locationId','intExt','tod','camera','lens','brackets','evStep','directions','chart'],
    filters:[
      { k:'tod', ref:'tod', label:'시간대' },
      { k:'chart', ref:'hdriCharts', label:'차트' },
      { k:'keySource', ref:'keySources', label:'키 소스' },
    ],
    listCols:['hdriId','locationId','intExt','tod','camera','brackets','keyStop','keySource'],
    csvCols:['id','hdriId','locationId','intExt','tod',
             'camera','lens','brackets','evStep','directions','chart',
             'iso','shutter','wb','tStop','keyStop','keyDirection','keySource','meterMode',
             'lightColor','ambientStop','ratio','notes','createdAt','updatedAt'],
    groups:[
      /* 4열 고정 — 1행: HDRI ID · 로케이션   2행: INT/EXT · 시간대 */
      { title:'기본정보', cols:4, fields:[
        { k:'thumbnail', label:'대표 이미지', t:'photo', preset:'thumb', span:1, rowSpan:2 },
        { k:'hdriId', label:'HDRI ID', t:'text', span:1 },
        { k:'locationId', label:'로케이션', t:'recordRef', to:'locations', span:2 },
        { k:'intExt', label:'INT / EXT', t:'select', ref:'intExt', span:1 },
        { k:'tod',    label:'시간대',    t:'select', ref:'tod', span:1 },
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
        { k:'hdriPhotos', label:'HDRI 소스', t:'photos', n:8, perRow:8, preset:'plate', full:true },
        { k:'chartPhotos', label:'차트 / 볼', t:'photos', n:4, perRow:4, full:true },
        { k:'notes', label:'비고', t:'textarea', full:true },
        { k:'sketch', label:'스케치 (S펜)', t:'sketch', full:true },
      ]},
    ],
  },
};

/* 상단 네비 순서 */
export const NAV = [
  { k:'project',   label:'Project',    icon:'◫' },
  { k:'overview',  label:'Overview',   icon:'▦' },
  { k:'locations', label:'Location',   icon:'◈' },
  { k:'assets',    label:'Asset',      icon:'◇' },
  { k:'cameras',   label:'Camera',     icon:'◎' },
  { k:'hdri',      label:'HDRI',       icon:'◐' },
  { k:'scenes',    label:'Scene List', icon:'◧' },
  { k:'settings',  label:'Setting',    icon:'≡' },
  { k:'backup',    label:'Backup',     icon:'⤓' },
];

/* 리스트/에디터를 가진 엔티티 (네비에서 entityView 로 가는 것들) */
export const ENTITY_ROUTES = ['scenes','locations','assets','cameras','hdri'];

/* 구 vfxA / vfxB 값 → 새 vfxType 통계 축 매핑 */
export const VFX_TYPE_MAP = {
  '2D VFX':'2D', 'CLEAN UP':'2D', 'SCREEN':'2D', 'WIRE REMOVAL':'2D', 'BEAUTY':'2D', '2D Retouch':'2D',
  '3D VFX':'3D', 'SIMULATION':'3D', 'CREATURE':'3D', 'ENVIRONMENT':'3D',
  'COMPOSITING':'COMP', 'MATTE PAINT':'MATTE PAINT',
};

/** 레코드를 한 줄로 표기 (연결 목록·드롭다운에 쓰임) */
export function displayName(entKey, r){
  if (!r) return '';
  const cfg = ENTITIES[entKey];
  const head = cfg.titleFields.map(k => r[k]).filter(Boolean).join(' · ');
  const sub  = (cfg.subtitleFields || []).map(k => r[k]).filter(Boolean).join(' · ');
  return [head, sub].filter(Boolean).join(cfg.nameSep || ' — ') || r.id;
}

/**
 * 리스트·인쇄에 쓸 대표 이미지.
 * 캠 탭이 있는 엔티티는 이미지가 캠별로 흩어져 있다.
 * 선언 순서(A → B → C → D)대로 훑어서 먼저 나오는 것을 쓴다.
 * 즉 A 에 이미지가 있으면 무조건 A 가 대표가 된다.
 * (구 데이터는 레코드 최상단에 있으므로 그것도 함께 본다)
 */
export function thumbOf(entKey, r){
  const cfg = ENTITIES[entKey];
  if (!r) return null;
  if (Array.isArray(cfg.cams) && r.cams){
    for (const c of cfg.cams){
      const v = (r.cams[c] || {})[cfg.thumbField];
      if (v && v.mid) return v;
    }
  }
  const own = r[cfg.thumbField];
  return (own && own.mid) ? own : null;
}

/** 어느 캠에든 들어 있는 특정 키의 값들 (필터·검색용) */
export function camValues(cfg, r, key){
  if (!Array.isArray(cfg.cams) || !r || !r.cams) return [];
  return cfg.cams.map(c => (r.cams[c] || {})[key]).filter(Boolean);
}

/**
 * 캠별로 흩어진 한 필드를 목록용 한 줄로 요약한다.
 * 캠이 전부 같은 값이면 값만 ('3D'), 다르면 캠을 붙인다 ('A: 3D · B: 2D').
 */
export function camFieldLine(entKey, r, key){
  const cfg = ENTITIES[entKey];
  if (!Array.isArray(cfg.cams) || !r || !r.cams) return '';
  const used = usedCams(entKey, r);
  const pairs = used.map(c => [c, (r.cams[c] || {})[key]]).filter(([,v]) => v);
  if (!pairs.length) return '';
  const vals = Array.from(new Set(pairs.map(([,v]) => v)));
  if (vals.length === 1 && pairs.length === used.length) return vals[0];
  return pairs.map(([c,v]) => `${c}: ${v}`).join(' · ');
}

/**
 * 캠별 기록을 한 줄로 — 'A027 C002 / B027 C001'
 * 캠 이름(A:)은 붙이지 않는다. 캠 롤 첫 글자가 이미 어느 캠인지 말해 주고,
 * 목록에서 이 칸이 넓어지면 가로 스크롤이 생긴다.
 */
export function camSummaryLine(entKey, r){
  const cfg = ENTITIES[entKey];
  if (!Array.isArray(cfg.cams) || !r || !r.cams) return '';
  return cfg.cams
    .map(c => {
      const d = r.cams[c] || {};
      return [d.camRoll, d.clip].filter(Boolean).join(' ');
    })
    .filter(Boolean).join(' / ');
}

/**
 * "실제로 이 캠으로 찍었다"고 볼 수 있는 캠 목록. 캠 기록 수 · VFX 물량이 이걸로 센다.
 *
 * 판정에 쓰는 필드는 스키마에서 정한다 — cam:true 이면서 soft 가 아닌 것.
 *  - 하드코딩하면 필드가 늘 때마다 빠뜨린다 (작업 타입이 그래서 물량에서 누락됐었다)
 *  - 반대로 전부 세면 상속으로 자동 채워지는 값(촬영 유닛)까지 근거가 돼서
 *    찍지도 않은 캠이 잡힌다 → 그런 필드는 soft:true 로 뺀다
 */
export function usedCams(entKey, r){
  const cfg = ENTITIES[entKey];
  if (!Array.isArray(cfg.cams) || !r || !r.cams) return [];
  const keys = allFields(entKey).filter(f => f.cam && !f.soft);
  const filled = (v) => {
    if (!v) return false;
    if (Array.isArray(v)) return v.some(x => x && x.mid);
    if (typeof v === 'object') return !!v.mid;
    return String(v).trim() !== '';
  };
  return cfg.cams.filter(c => {
    const d = r.cams[c] || {};
    return keys.some(f => filled(d[f.k]));
  });
}

/** 컷을 한 줄로 표기 — 'C1 / B캠' */
export function cutLabel(c){
  return `C${c.cutNo || '?'}${c.camUnit ? ' / ' + c.camUnit + '캠' : ''}`;
}

/**
 * 모니터 사진에서 읽은 캠(A/B/…)을 보고 테이크를 어느 컷에 넣을지 후보를 만든다.
 * 자동으로 꽂아넣지 않고 후보만 만드는 이유: 같은 캠으로 여러 컷을 찍기 때문에
 * 클립 번호만으로는 컷 경계를 알 수 없다. 마지막 컷을 기본값으로 제안하고 사람이 확인한다.
 *
 * @param {Array}  cuts     이 씬의 컷 (컷번호 → 캠 순 정렬)
 * @param {string} camUnit  'A' / 'B' / '' (판독 실패)
 * @returns {{targets:Array<{value:string,label:string}>, defaultTarget:string}}
 *          value 는 컷 id / 'pair:<컷id>'(동시 촬영 짝 생성) / '__new'
 */
export function planMonitorTake(cuts, camUnit){
  const cam = String(camUnit || '').toUpperCase();
  const of = (c) => String(c.camUnit || '').toUpperCase();
  const targets = [];

  // 1) 같은 캠으로 이미 찍고 있던 컷 — 가장 흔한 경우
  const sameCam = cam ? cuts.filter(c => of(c) === cam) : cuts.slice();
  for (const c of sameCam) targets.push({ value:c.id, label:`${cutLabel(c)} 에 테이크 추가` });

  // 2) 다른 캠 컷과 동시 촬영으로 묶기 — 같은 컷 번호·슬레이트의 짝을 새로 만든다
  const seen = new Set();
  if (cam){
    for (const c of cuts){
      if (of(c) === cam || seen.has(c.cutNo)) continue;
      if (cuts.some(x => x.cutNo === c.cutNo && of(x) === cam)) continue;
      seen.add(c.cutNo);
      targets.push({ value:'pair:'+c.id, label:`${cutLabel(c)} 과 동시 — ${cam}캠 컷 새로 생성` });
    }
  }

  // 3) 새 컷
  targets.push({ value:'__new', label: cam ? `새 컷 만들기 (${cam}캠)` : '새 컷 만들기' });

  // 4) 나머지 컷 (다른 캠에 잘못 들어간 걸 바로잡을 때)
  for (const c of cuts) if (!targets.some(t => t.value === c.id))
    targets.push({ value:c.id, label:`${cutLabel(c)} 에 테이크 추가` });

  const pair = targets.find(t => String(t.value).startsWith('pair:'));
  const defaultTarget = sameCam.length ? sameCam[sameCam.length - 1].id
                      : (pair ? pair.value : '__new');
  return { targets, defaultTarget };
}

export function allFields(ent){ return ENTITIES[ent].groups.flatMap(g => g.fields); }
export function fieldMap(ent){ const m={}; for (const f of allFields(ent)) m[f.k]=f; return m; }
export function labelOf(ent, key){
  const f = fieldMap(ent)[key];
  if (f) return f.label;
  return { id:'ID', sceneId:'씬 ID', episode:'에피소드', scene:'씬',
           __cams:'캠 기록', __vfx:'작업 타입',
           takeCount:'테이크 수', okTakes:'OK 테이크',
           createdAt:'생성', updatedAt:'수정' }[key] || key;
}
