/**
 * HWPX 문서 서식 표준 스타일 및 테두리 레지스트리
 *
 * KS X 6109 / OWPML 표준 규격 준수:
 * - D1: 모든 항목 목록(charPr, paraPr, style, borderFill)의 ID는 목록 순서와 일치하는 연속 번호 (charPr/paraPr/style: 0..n-1, borderFill: 1..n)
 * - D2: borderFill 1(NONE, 페이지 테두리 전용), 2(SOLID 0.12mm, 일반 셀/외곽), 3(SOLID 0.12mm + #F2F2F2, 라벨 셀)
 * - D4: 모든 charPr를 동일한 완전한 템플릿(fontRef, ratio, spacing, relSz, offset, underline, strikeout, outline, shadow)으로 생성, shadeColor="none", borderFillIDRef 제외
 */

export interface CharPrSpec {
  height: number; // 1pt = 100 HWPUNIT (예: 16pt = 1600, 12pt = 1200, 10pt = 1000, 9pt = 900)
  bold: boolean;
  color?: string;
}

export interface ParaPrSpec {
  align?: 'LEFT' | 'CENTER' | 'RIGHT';
  prev?: number;
  next?: number;
  lineSpacingPercent?: number;
}

export interface BorderFillSpec {
  isPageBorder?: boolean;
  fillColor?: string | null;
}

export interface StyleSpec {
  name: string;
  engName: string;
  paraPrId: string;
  charPrId: string;
}

export interface RegisteredRole {
  charPrId: string;
  paraPrId: string;
  borderFillId?: string;
}

export function createStyleRegistry() {
  const charPrs: (CharPrSpec & { id: string })[] = [];
  const paraPrs: (ParaPrSpec & { id: string })[] = [];
  const borderFills: (BorderFillSpec & { id: string })[] = [];
  const styles: (StyleSpec & { id: string })[] = [];

  function registerCharPr(spec: CharPrSpec): string {
    const id = String(charPrs.length);
    charPrs.push({ ...spec, id });
    return id;
  }

  function registerParaPr(spec: ParaPrSpec): string {
    const id = String(paraPrs.length);
    paraPrs.push({ ...spec, id });
    return id;
  }

  function registerBorderFill(spec: BorderFillSpec): string {
    const id = String(borderFills.length + 1); // borderFill은 1부터 시작
    borderFills.push({ ...spec, id });
    return id;
  }

  function registerStyle(spec: StyleSpec): string {
    const id = String(styles.length);
    styles.push({ ...spec, id });
    return id;
  }

  // 1. D2: borderFill 사전 등록 (id=1: 페이지 테두리 NONE, id=2: 일반 셀 SOLID, id=3: 라벨 셀 SOLID+#F2F2F2)
  const BF_PAGE = registerBorderFill({ isPageBorder: true });
  const BF_CELL = registerBorderFill({ isPageBorder: false, fillColor: null });
  const BF_LABEL = registerBorderFill({ isPageBorder: false, fillColor: '#F2F2F2' });

  // 2. D1 & D4: charPr 사전 등록 (연속 번호 0..n-1, 완전한 템플릿 구조)
  const CP_NORMAL = registerCharPr({ height: 1000, bold: false, color: '#111827' }); // id=0 (기본 바탕글 10pt)
  const CP_TITLE = registerCharPr({ height: 1900, bold: true, color: '#111827' }); // id=1 (19pt 굵게)
  const CP_HEADING = registerCharPr({ height: 1200, bold: true, color: '#111827' }); // id=2 (12pt 굵게)
  const CP_LABEL = registerCharPr({ height: 1000, bold: true, color: '#111827' }); // id=3 (10pt 굵게)
  const CP_VALUE = registerCharPr({ height: 1000, bold: false, color: '#111827' }); // id=4 (10pt 보통)
  const CP_VALUE_BOLD = registerCharPr({ height: 1000, bold: true, color: '#111827' }); // id=5 (10pt 굵게)
  const CP_NOTE = registerCharPr({ height: 950, bold: false, color: '#4B5563' }); // id=6 (9.5pt 보통)
  const CP_META = registerCharPr({ height: 850, bold: false, color: '#4B5563' }); // id=7 (8.5pt 보통)

  // 3. paraPr 사전 등록 (연속 번호 0..n-1, 문단 테두리 없음, 줄간격 180%)
  const PP_LEFT = registerParaPr({ align: 'LEFT', prev: 0, next: 0, lineSpacingPercent: 150 }); // id=0 (줄간격 150%)
  const PP_CENTER = registerParaPr({ align: 'CENTER', prev: 0, next: 0, lineSpacingPercent: 150 }); // id=1
  const PP_RIGHT = registerParaPr({ align: 'RIGHT', prev: 0, next: 0, lineSpacingPercent: 150 }); // id=2
  const PP_HEADING = registerParaPr({ align: 'LEFT', prev: 500, next: 300, lineSpacingPercent: 140 }); // id=3 (위5pt, 아래3pt)
  const PP_TITLE = registerParaPr({ align: 'CENTER', prev: 300, next: 500, lineSpacingPercent: 140 }); // id=4 (위3pt, 아래5pt)
  const PP_META = registerParaPr({ align: 'LEFT', prev: 800, next: 100, lineSpacingPercent: 140 }); // id=5 (위8pt)

  const PP_TBL_LEFT = registerParaPr({ align: 'LEFT', prev: 0, next: 0, lineSpacingPercent: 100 }); // id=6 (표 담는 문단)
  const PP_TBL_RIGHT = registerParaPr({ align: 'RIGHT', prev: 0, next: 0, lineSpacingPercent: 100 }); // id=7 (표 담는 문단, 우측)

  // 4. style 사전 등록 (id=0: 바탕글)
  const ST_NORMAL = registerStyle({ name: '바탕글', engName: 'Normal', paraPrId: '0', charPrId: '0' });

  // D4: 완전한 charPr 템플릿 직렬화 함수
  function renderCharPrXml(cp: CharPrSpec & { id: string }): string {
    const boldTag = cp.bold ? '<hh:bold/>' : '';
    return `<hh:charPr id="${cp.id}" height="${cp.height}" textColor="${cp.color || '#111827'}" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE">` +
      `<hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>` +
      `<hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>` +
      `<hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>` +
      `<hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>` +
      `<hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>` +
      boldTag +
      `<hh:underline type="NONE" shape="SOLID" color="#000000"/>` +
      `<hh:strikeout shape="NONE" color="#000000"/>` +
      `<hh:outline type="NONE"/>` +
      `<hh:shadow type="NONE" color="#B2B2B2" offsetX="10" offsetY="10"/>` +
    `</hh:charPr>`;
  }

  // D2: borderFill 직렬화 함수
  function renderBorderFillXml(bf: BorderFillSpec & { id: string }): string {
    if (bf.isPageBorder) {
      return `<hh:borderFill id="${bf.id}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">` +
        `<hh:slash type="NONE" Crooked="0" isCounter="0"/>` +
        `<hh:backSlash type="NONE" Crooked="0" isCounter="0"/>` +
        `<hh:leftBorder type="NONE" width="0.1 mm" color="#000000"/>` +
        `<hh:rightBorder type="NONE" width="0.1 mm" color="#000000"/>` +
        `<hh:topBorder type="NONE" width="0.1 mm" color="#000000"/>` +
        `<hh:bottomBorder type="NONE" width="0.1 mm" color="#000000"/>` +
        `<hh:diagonal type="NONE" width="0.1 mm" color="#000000"/>` +
      `</hh:borderFill>`;
    }
    const fillBrush = bf.fillColor
      ? `<hc:fillBrush><hc:winBrush faceColor="${bf.fillColor}" hatchColor="#FF000000" alpha="0"/></hc:fillBrush>`
      : '';
    return `<hh:borderFill id="${bf.id}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">` +
      `<hh:slash type="NONE" Crooked="0" isCounter="0"/>` +
      `<hh:backSlash type="NONE" Crooked="0" isCounter="0"/>` +
      `<hh:leftBorder type="SOLID" width="0.12 mm" color="#000000"/>` +
      `<hh:rightBorder type="SOLID" width="0.12 mm" color="#000000"/>` +
      `<hh:topBorder type="SOLID" width="0.12 mm" color="#000000"/>` +
      `<hh:bottomBorder type="SOLID" width="0.12 mm" color="#000000"/>` +
      `<hh:diagonal type="SOLID" width="0.12 mm" color="#000000"/>` +
      fillBrush +
    `</hh:borderFill>`;
  }

  // paraPr 직렬화 함수 (문단 테두리 borderFill 참조 제거, 줄간격 180% 통일)
  function renderParaPrXml(pp: ParaPrSpec & { id: string }): string {
    const align = pp.align || 'LEFT';
    const prev = pp.prev || 0;
    const next = pp.next || 0;
    const lSpacing = pp.lineSpacingPercent || 180;
    return `<hh:paraPr id="${pp.id}" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0">` +
      `<hh:align horizontal="${align}" vertical="BASELINE"/>` +
      `<hh:heading type="NONE" idRef="0" level="0"/>` +
      `<hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="BREAK_WORD" widowOrphan="0" keepWithNext="0" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>` +
      `<hp:switch><hp:case hp:required-namespace="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar">` +
        `<hh:margin><hc:intent value="0" unit="HWPUNIT"/><hc:left value="0" unit="HWPUNIT"/><hc:right value="0" unit="HWPUNIT"/><hc:prev value="${prev}" unit="HWPUNIT"/><hc:next value="${next}" unit="HWPUNIT"/></hh:margin>` +
        `<hh:lineSpacing type="PERCENT" value="${lSpacing}" unit="HWPUNIT"/>` +
      `</hp:case><hp:default>` +
        `<hh:margin><hc:intent value="0" unit="HWPUNIT"/><hc:left value="0" unit="HWPUNIT"/><hc:right value="0" unit="HWPUNIT"/><hc:prev value="${prev}" unit="HWPUNIT"/><hc:next value="${next}" unit="HWPUNIT"/></hh:margin>` +
        `<hh:lineSpacing type="PERCENT" value="${lSpacing}" unit="HWPUNIT"/>` +
      `</hp:default></hp:switch>` +
      `<hh:autoSpacing eAsianEng="0" eAsianNum="0"/>` +
    `</hh:paraPr>`;
  }

  // style 직렬화 함수
  function renderStyleXml(st: StyleSpec & { id: string }): string {
    return `<hh:style id="${st.id}" type="PARA" name="${st.name}" engName="${st.engName}" paraPrIDRef="${st.paraPrId}" charPrIDRef="${st.charPrId}" nextStyleIDRef="${st.id}" langID="1042" lockForm="0"/>`;
  }

  return {
    roles: {
      TITLE: { charPrId: CP_TITLE, paraPrId: PP_TITLE },
      HEADING: { charPrId: CP_HEADING, paraPrId: PP_HEADING },
      LABEL: { charPrId: CP_LABEL, paraPrId: PP_CENTER, borderFillId: BF_LABEL },
      VALUE: { charPrId: CP_VALUE, paraPrId: PP_LEFT, borderFillId: BF_CELL },
      VALUE_BOLD: { charPrId: CP_VALUE_BOLD, paraPrId: PP_LEFT, borderFillId: BF_CELL },
      NOTE: { charPrId: CP_NOTE, paraPrId: PP_LEFT, borderFillId: BF_CELL },
      META: { charPrId: CP_META, paraPrId: PP_META },
    },
    borders: {
      PAGE: BF_PAGE, // '1'
      CELL: BF_CELL, // '2'
      LABEL: BF_LABEL, // '3'
    },
    paras: {
      LEFT: PP_LEFT, // '0'
      CENTER: PP_CENTER, // '1'
      RIGHT: PP_RIGHT, // '2'
      HEADING: PP_HEADING, // '3'
      TITLE: PP_TITLE, // '4'
      META: PP_META, // '5'
      TBL_LEFT: PP_TBL_LEFT, // '6'
      TBL_RIGHT: PP_TBL_RIGHT, // '7'
    },
    styles: {
      NORMAL: ST_NORMAL, // '0'
    },
    serializeHeaderParts() {
      return {
        borderFillsXml: `<hh:borderFills itemCnt="${borderFills.length}">${borderFills.map(renderBorderFillXml).join('')}</hh:borderFills>`,
        charPropertiesXml: `<hh:charProperties itemCnt="${charPrs.length}">${charPrs.map(renderCharPrXml).join('')}</hh:charProperties>`,
        paraPropertiesXml: `<hh:paraProperties itemCnt="${paraPrs.length}">${paraPrs.map(renderParaPrXml).join('')}</hh:paraProperties>`,
        stylesXml: `<hh:styles itemCnt="${styles.length}">${styles.map(renderStyleXml).join('')}</hh:styles>`,
      };
    },
  };
}
