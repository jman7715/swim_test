const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx');

/**
 * 엑셀 날짜(일련번호 수치 또는 문자열)를 YYYY-MM-DD 포맷으로 변환하는 함수
 */
function formatExcelDate(excelDate) {
    if (!excelDate) return '-';
    
    const strDate = String(excelDate).trim();
    if (strDate.includes('-') || strDate.includes('/')) {
        return strDate.substring(0, 10).replace(/\//g, '-');
    }

    const numDate = Number(excelDate);
    if (!isNaN(numDate) && numDate > 10000) {
        const dateObj = new Date((numDate - 25569) * 86400 * 1000);
        const yyyy = dateObj.getFullYear();
        const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
        const dd = String(dateObj.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }

    return strDate;
}

/**
 * '대회정보' 시트에서 모든 관리자 목록을 읽어오는 함수
 */
function getAllAdminConfigs() {
    try {
        const filePath = path.join(__dirname, 'swimmers.xlsx');
        const workbook = xlsx.readFile(filePath);
        const sheet = workbook.Sheets['대회정보'];
        if (!sheet) return [];

        const data = xlsx.utils.sheet_to_json(sheet);
        return data.map(row => ({
            adminName: String(row['관리자이름'] || row['adminName'] || '').trim(),
            adminPassword: String(row['관리자비번'] || row['adminPassword'] || '').trim(),
            adminAuth: String(row['관리자권한'] || row['adminAuth'] || '보기').trim()
        })).filter(admin => admin.adminName !== '');
    } catch (error) {
        console.error("관리자 설정 엑셀 읽기 오류:", error);
        return [];
    }
}

/**
 * 특정 관리자 이름으로 정보를 찾는 함수
 */
function getAdminByName(adminName) {
    const admins = getAllAdminConfigs();
    if (!adminName) return null;
    return admins.find(a => a.adminName === String(adminName).trim()) || null;
}

/**
 * 엑셀 파일에서 원래 헤더(열 순서) 정보 추출하는 함수
 */
function getPlayerSheetHeaders(sheet) {
    if (!sheet || !sheet['!ref']) return [];
    
    const range = xlsx.utils.decode_range(sheet['!ref']);
    const headers = [];

    for (let c = range.s.c; c <= range.e.c; c++) {
        const cellAddress = xlsx.utils.encode_cell({ r: range.s.r, c: c });
        const cell = sheet[cellAddress];
        if (cell && cell.v !== undefined) {
            headers.push(String(cell.v).trim());
        }
    }
    return headers;
}

/**
 * 엑셀 파일에서 '선수명단' 시트를 읽어오는 함수
 */
function getPlayerListAndHeaders() {
    try {
        const filePath = path.join(__dirname, 'swimmers.xlsx');
        const workbook = xlsx.readFile(filePath);
        const sheet = workbook.Sheets['선수명단'];
        if (!sheet) return { players: [], headers: [] };

        const headers = getPlayerSheetHeaders(sheet);
        const players = xlsx.utils.sheet_to_json(sheet, { defval: '' });

        return { players, headers };
    } catch (error) {
        console.error("선수 명단 엑셀 읽기 오류:", error);
        return { players: [], headers: [] };
    }
}

/**
 * 수정된 '선수명단' 데이터를 엑셀 파일에 안전하게 저장하는 함수
 */
function savePlayerList(players, headers) {
    try {
        const filePath = path.join(__dirname, 'swimmers.xlsx');
        const workbook = xlsx.readFile(filePath);

        let headerOption = headers;
        if (!headerOption || headerOption.length === 0) {
            if (players.length > 0) {
                headerOption = Object.keys(players[0]);
            }
        }

        const newSheet = xlsx.utils.json_to_sheet(players, { header: headerOption });

        workbook.Sheets['선수명단'] = newSheet;
        xlsx.writeFile(workbook, filePath);
        return true;
    } catch (error) {
        console.error("선수 명단 엑셀 저장 오류:", error);
        return false;
    }
}

/**
 * 단일 admin.html 템플릿에서 특정 섹션만 남기고 데이터를 치환하여 렌더링하는 헬퍼 함수
 */
function renderTemplate(pageTitle, activeSection, data) {
    const templatePath = path.join(__dirname, 'admin.html');
    let html = fs.readFileSync(templatePath, 'utf8');

    html = html.replace('{{PAGE_TITLE}}', pageTitle);

    const sections = ['LOGIN_SECTION', 'DASHBOARD_SECTION', 'PLAYERS_SECTION'];
    sections.forEach(sec => {
        const startTag = `{{#IF_${sec}}}`;
        const endTag = `{{/IF_${sec}}}`;
        if (sec === activeSection) {
            html = html.replace(startTag, '').replace(endTag, '');
        } else {
            const regex = new RegExp(`${startTag}[\\s\\S]*?${endTag}`, 'g');
            html = html.replace(regex, '');
        }
    });

    for (const [key, value] of Object.entries(data)) {
        const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
        html = html.replace(regex, value !== undefined && value !== null ? value : '');
    }

    return html;
}

// [GET] /admin - 대시보드 메인 화면 (또는 로그인 화면)
router.get('/', (req, res) => {
    const isLoggedIn = req.query.login === 'success';
    const currentAdminName = String(req.query.adminName || '').trim();

    if (!isLoggedIn || !currentAdminName) {
        const errorHtml = req.query.error ? '<div class="error-msg">관리자 이름 또는 비밀번호가 올바르지 않습니다.</div>' : '';
        const html = renderTemplate('관리자 로그인', 'LOGIN_SECTION', {
            ERROR_MSG: errorHtml
        });
        return res.send(html);
    }

    const adminInfo = getAdminByName(currentAdminName);
    const adminAuth = adminInfo ? adminInfo.adminAuth : '보기';

    const { players } = getPlayerListAndHeaders();
    const totalCount = players.length;

    const eventStats = {};
    let paidCount = 0;
    let unpaidCount = 0;
    let freeCount = 0;
    let unknownFeeCount = 0;

    players.forEach(player => {
        const rawEvent = String(player['희망종목'] || '').trim();
        let eventKey = '미확인';
        if (rawEvent.length > 0) {
            eventKey = rawEvent.substring(0, 7);
        }
        eventStats[eventKey] = (eventStats[eventKey] || 0) + 1;

        const feeStatus = String(player['참가비현황'] || '').trim();
        if (feeStatus === '납부완료' || feeStatus === '완납') {
            paidCount++;
        } else if (feeStatus === '미납') {
            unpaidCount++;
        } else if (feeStatus === '무료' || feeStatus === '무료출전권') {
            freeCount++;
        } else {
            unknownFeeCount++;
        }
    });

    const sortedEventEntries = Object.entries(eventStats).sort((a, b) => {
        if (a[0] === '미확인') return 1;
        if (b[0] === '미확인') return -1;
        return a[0].localeCompare(b[0], 'ko-KR', { numeric: true, sensitivity: 'base' });
    });

    let eventCardsHtml = '';
    if (sortedEventEntries.length > 0) {
        for (const [eventName, count] of sortedEventEntries) {
            const cardHref = adminAuth === '보기' ? '#' : `/admin/players?adminName=${encodeURIComponent(currentAdminName)}&searchEvent=${encodeURIComponent(eventName)}`;
            eventCardsHtml += `
                <a href="${cardHref}" class="stat-card-link">
                    <div class="stat-card event-card">
                        <h4>${eventName}</h4>
                        <div class="number">${count} 명</div>
                    </div>
                </a>
            `;
        }
    } else {
        eventCardsHtml = '<div style="grid-column: span 4; padding: 20px; text-align: center; color: #999;">접수된 데이터가 없습니다.</div>';
    }

    let actionAreaHtml = '';
    if (adminAuth === '보기') {
        actionAreaHtml = `
            <div style="text-align: center; margin-top: 40px; border-top: 1px solid #eee; padding-top: 20px;">
                <span class="disabled-btn" title="보기 권한 계정은 선수 명단 관리에 접근할 수 없습니다.">🔍 전체 선수 명단 조회 및 관리 (권한 필요)</span>
            </div>
        `;
    } else {
        actionAreaHtml = `
            <div style="text-align: center; margin-top: 40px; border-top: 1px solid #eee; padding-top: 20px;">
                <a href="/admin/players?adminName=${encodeURIComponent(currentAdminName)}" class="view-all-btn">🔍 전체 선수 명단 조회 및 관리</a>
            </div>
        `;
    }

    const alertDeniedHtml = req.query.denied ? '<div class="alert-denied">⚠️ 해당 기능에 접근할 수 있는 권한이 없습니다. (현재 권한: 보기)</div>' : '';

    const html = renderTemplate('관리자 대시보드', 'DASHBOARD_SECTION', {
        CURRENT_ADMIN_NAME: currentAdminName,
        ADMIN_AUTH: adminAuth,
        ALERT_DENIED_HTML: alertDeniedHtml,
        TOTAL_COUNT: totalCount,
        EVENT_CARDS_HTML: eventCardsHtml,
        PAID_CARD_HREF: adminAuth === '보기' ? '#' : `/admin/players?adminName=${encodeURIComponent(currentAdminName)}&searchFee=납부완료`,
        PAID_COUNT: paidCount,
        UNPAID_CARD_HREF: adminAuth === '보기' ? '#' : `/admin/players?adminName=${encodeURIComponent(currentAdminName)}&searchFee=미납`,
        UNPAID_COUNT: unpaidCount,
        FREE_CARD_HREF: adminAuth === '보기' ? '#' : `/admin/players?adminName=${encodeURIComponent(currentAdminName)}&searchFee=무료출전권`,
        FREE_COUNT: freeCount,
        UNKNOWN_CARD_HREF: adminAuth === '보기' ? '#' : `/admin/players?adminName=${encodeURIComponent(currentAdminName)}&searchFee=미확인`,
        UNKNOWN_FEE_COUNT: unknownFeeCount,
        ACTION_AREA_HTML: actionAreaHtml
    });

    res.send(html);
});

// [GET] /admin/players - 선수 목록 및 수정 화면
router.get('/players', (req, res) => {
    const currentAdminName = String(req.query.adminName || '').trim();
    const adminInfo = getAdminByName(currentAdminName);
    const adminAuth = adminInfo ? adminInfo.adminAuth : '보기';

    if (adminAuth === '보기' || !adminInfo) {
        return res.redirect(`/admin?login=success&adminName=${encodeURIComponent(currentAdminName)}&denied=1`);
    }

    const { players } = getPlayerListAndHeaders();

    const searchName = String(req.query.searchName || '').trim();
    const searchPhone4 = String(req.query.searchPhone4 || '').trim();
    const searchEvent = String(req.query.searchEvent || '').trim();
    const searchFee = String(req.query.searchFee || '').trim();

    const allEventsSet = new Set();
    players.forEach(p => {
        const rawEvt = String(p['희망종목'] || '').trim();
        if (rawEvt.length > 0) {
            allEventsSet.add(rawEvt.substring(0, 7));
        }
    });

    const filteredPlayers = players.filter(player => {
        if (searchName && !String(player['이름'] || '').includes(searchName)) return false;
        
        /*
        const pPhone = String(player['연락처'] || '');
        const pPhone4 = String(player['연락처4'] || pPhone.slice(-4));
        if (searchPhone4 && !pPhone4.includes(searchPhone4) && !pPhone.includes(searchPhone4)) return false;
        */

        const pPhone = String(player['연락처'] || '').replace(/[^0-9]/g, '');
        const pPhone4 = String(player['연락처4'] || '').trim() || pPhone.slice(-4);
        if (searchPhone4 && pPhone4 !== searchPhone4) return false;


        const pEvent = String(player['희망종목'] || '').trim();
        if (searchEvent) {
            if (searchEvent === '미확인' && pEvent.length > 0) return false;
            if (searchEvent !== '미확인' && !pEvent.startsWith(searchEvent)) return false;
        }

        const pFee = String(player['참가비현황'] || '').trim();
        if (searchFee) {
            if (searchFee === '납부완료' && !(pFee === '납부완료' || pFee === '완납')) return false;
            if (searchFee === '미납' && pFee !== '미납') return false;
            if (searchFee === '무료출전권' && !(pFee === '무료' || pFee === '무료출전권')) return false;
            if (searchFee === '미확인' && (pFee === '납부완료' || pFee === '완납' || pFee === '미납' || pFee === '무료' || pFee === '무료출전권')) return false;
        }
        return true;
    });

    const allEventsList = Array.from(allEventsSet).sort();
    let eventOptionsHtml = '<option value="">전체 (모든 종목)</option>';
    allEventsList.forEach(evt => {
        const selected = searchEvent === evt ? 'selected' : '';
        eventOptionsHtml += `<option value="${evt}" ${selected}>${evt}</option>`;
    });

    let playerRowsHtml = '';
    if (filteredPlayers.length > 0) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        filteredPlayers.forEach((player, index) => {
            const name = player['이름'] || '';
            const phone = player['연락처'] || '';

            const rawRegDate = player['접수날짜'] || player['등록시간'] || '';
            const regDate = formatExcelDate(rawRegDate);

            // PC용 전체 날짜 (YYYY-MM-DD)와 모바일용 단축 날짜 (MM/DD) 생성
            let regDateFull = regDate;
            let regDateShort = regDate;
            if (regDate !== '-' && regDate.includes('-')) {
                const dateParts = regDate.split('-');
                if (dateParts.length >= 3) {
                    regDateShort = `${dateParts[1]}<br>${dateParts[2]}`;
                }
            }

            let isOver3DaysUnpaid = false;
            if (regDate !== '-') {
                const regDateObj = new Date(regDate);
                regDateObj.setHours(0, 0, 0, 0);
                const diffDays = (today - regDateObj) / (1000 * 60 * 60 * 24);
                
                const currentFeeRaw = String(player['참가비현황'] || '').trim();
                if (diffDays >= 3 && currentFeeRaw === '미납') {
                    isOver3DaysUnpaid = true;
                }
            }

            let rowBgColor = '';
            if (isOver3DaysUnpaid) {
                rowBgColor = 'background-color: #f8d7da;';
            } else {
                const groupIndex = Math.floor(index / 3);
                rowBgColor = groupIndex % 2 === 0 ? 'background-color: #ffffff;' : 'background-color: #f2f2f2;';
            }

            const rawEvent = String(player['희망종목'] || '').trim();
            const currentEvent = rawEvent.length > 0 ? rawEvent.substring(0, 7) : '미확인';
            const currentFee = player['참가비현황'] || '';

            let itemEventOptions = '';
            allEventsList.forEach(evt => {
                itemEventOptions += `<option value="${evt}" ${evt === currentEvent ? 'selected' : ''}>${evt}</option>`;
            });

            const feeList = ['납부완료', '미납', '무료출전권', '미확인'];
            let itemFeeOptions = '';
            feeList.forEach(f => {
                itemFeeOptions += `<option value="${f}" ${f === currentFee ? 'selected' : ''}>${f}</option>`;
            });

            playerRowsHtml += `
                <tr style="${rowBgColor}">
                    <td>
                        <span class="date-full">${regDateFull}</span>
                        <span class="date-short">${regDateShort}</span>
                    </td>
                    <td><strong>${name}</strong></td>
                    <td>
                        <input type="text" name="phone_${index}" value="${phone}" style="width: 120px; padding: 4px; text-align: center;">
                    </td>
                    <td>
                        <select name="event_${index}" style="padding: 4px;">
                            ${itemEventOptions}
                        </select>
                    </td>
                    <td>
                        <select name="fee_${index}" style="padding: 4px;">
                            ${itemFeeOptions}
                        </select>
                    </td>
                    <td>
                        <form action="/admin/update-player" method="POST" style="margin:0;">
                            <input type="hidden" name="adminName" value="${currentAdminName}">
                            <input type="hidden" name="name" value="${name}">
                            <input type="hidden" name="phone" value="${phone}">
                            <input type="hidden" name="updatedPhone" id="updatedPhone_${index}">
                            <input type="hidden" name="updatedEvent" id="updatedEvent_${index}">
                            <input type="hidden" name="updatedFee" id="updatedFee_${index}">
                            <button type="submit" onclick="submitUpdate(${index})" class="update-btn">수<br>정</button>
                        </form>
                    </td>
                </tr>
            `;
        });
    } else {
        playerRowsHtml = `<tr><td colspan="6" style="text-align: center; color: #999; padding: 20px;">검색 조건에 해당하는 선수 데이터가 없습니다.</td></tr>`;
    }

    const downloadQueryString = `adminName=${encodeURIComponent(currentAdminName)}&searchName=${encodeURIComponent(searchName)}&searchPhone4=${encodeURIComponent(searchPhone4)}&searchEvent=${encodeURIComponent(searchEvent)}&searchFee=${encodeURIComponent(searchFee)}`;
    const alertMsgHtml = req.query.updated ? '<div class="alert-msg">✅ 선수 정보가 성공적으로 수정되었습니다.</div>' : '';

    const html = renderTemplate('선수 명단 관리', 'PLAYERS_SECTION', {
        CURRENT_ADMIN_NAME: currentAdminName,
        ENCODED_ADMIN_NAME: encodeURIComponent(currentAdminName),
        ALERT_MSG_HTML: alertMsgHtml,
        SEARCH_NAME: searchName,
        SEARCH_PHONE4: searchPhone4,
        EVENT_OPTIONS_HTML: eventOptionsHtml,
        FEE_SELECTED_PAID: searchFee === '납부완료' ? 'selected' : '',
        FEE_SELECTED_UNPAID: searchFee === '미납' ? 'selected' : '',
        FEE_SELECTED_FREE: searchFee === '무료출전권' ? 'selected' : '',
        FEE_SELECTED_UNKNOWN: searchFee === '미확인' ? 'selected' : '',
        DOWNLOAD_QUERY_STRING: downloadQueryString,
        FILTERED_COUNT: filteredPlayers.length,
        PLAYER_ROWS_HTML: playerRowsHtml
    });

    res.send(html);
});

// [GET] /admin/download-excel - 엑셀 다운로드 라우트
router.get('/download-excel', (req, res) => {
    const currentAdminName = String(req.query.adminName || '').trim();
    const adminInfo = getAdminByName(currentAdminName);
    const adminAuth = adminInfo ? adminInfo.adminAuth : '보기';

    if (adminAuth === '보기' || !adminInfo) {
        return res.redirect(`/admin?login=success&adminName=${encodeURIComponent(currentAdminName)}&denied=1`);
    }

    const { players, headers } = getPlayerListAndHeaders();

    const searchName = String(req.query.searchName || '').trim();
    const searchPhone4 = String(req.query.searchPhone4 || '').trim();
    const searchEvent = String(req.query.searchEvent || '').trim();
    const searchFee = String(req.query.searchFee || '').trim();

    const filteredPlayers = players.filter(player => {
        if (searchName && !String(player['이름'] || '').includes(searchName)) return false;
        
        /*
        const pPhone = String(player['연락처'] || '');
        const pPhone4 = String(player['연락처4'] || pPhone.slice(-4));
        if (searchPhone4 && !pPhone4.includes(searchPhone4) && !pPhone.includes(searchPhone4)) return false;
        */

        const pPhone = String(player['연락처'] || '').replace(/[^0-9]/g, '');
        const pPhone4 = String(player['연락처4'] || '').trim() || pPhone.slice(-4);
        if (searchPhone4 && pPhone4 !== searchPhone4) return false;
        

        const pEvent = String(player['희망종목'] || '').trim();
        if (searchEvent) {
            if (searchEvent === '미확인' && pEvent.length > 0) return false;
            if (searchEvent !== '미확인' && !pEvent.startsWith(searchEvent)) return false;
        }

        const pFee = String(player['참가비현황'] || '').trim();
        if (searchFee) {
            if (searchFee === '납부완료' && !(pFee === '납부완료' || pFee === '완납')) return false;
            if (searchFee === '미납' && pFee !== '미납') return false;
            if (searchFee === '무료출전권' && !(pFee === '무료' || pFee === '무료출전권')) return false;
            if (searchFee === '미확인' && (pFee === '납부완료' || pFee === '완납' || pFee === '미납' || pFee === '무료' || pFee === '무료출전권')) return false;
        }
        return true;
    });

    let headerOption = headers;
    if (!headerOption || headerOption.length === 0) {
        if (filteredPlayers.length > 0) {
            headerOption = Object.keys(filteredPlayers[0]);
        }
    }

    const worksheet = xlsx.utils.json_to_sheet(filteredPlayers, { header: headerOption });
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, '선수명단');

    const excelBuffer = xlsx.write(workbook, { bookType: 'xlsx', type: 'buffer' });
    const fileName = `선수명단_${new Date().toISOString().substring(0, 10)}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.send(excelBuffer);
});

// [POST] /admin/login - 관리자 로그인 처리
router.post('/login', (req, res) => {
    const { adminName, adminPassword } = req.body;
    const admins = getAllAdminConfigs();

    const matchedAdmin = admins.find(a => 
        a.adminName === String(adminName).trim() && 
        a.adminPassword === String(adminPassword).trim()
    );

    if (matchedAdmin) {
        return res.redirect(`/admin?login=success&adminName=${encodeURIComponent(matchedAdmin.adminName)}`);
    } else {
        return res.redirect('/admin?error=1');
    }
});

// [POST] /admin/update-player - 개별 선수 정보 수정
router.post('/update-player', (req, res) => {
    const { adminName, name, phone, updatedPhone, updatedEvent, updatedFee } = req.body;
    const adminInfo = getAdminByName(adminName);
    const adminAuth = adminInfo ? adminInfo.adminAuth : '보기';

    if (adminAuth === '보기' || !adminInfo) {
        return res.redirect(`/admin?login=success&adminName=${encodeURIComponent(adminName)}&denied=1`);
    }

    const { players, headers } = getPlayerListAndHeaders();

    const playerIndex = players.findIndex(p => 
        String(p['이름'] || '').trim() === String(name).trim() && 
        String(p['연락처'] || '').trim() === String(phone).trim()
    );

    if (playerIndex !== -1) {
        players[playerIndex]['연락처'] = updatedPhone;
        players[playerIndex]['연락처4'] = String(updatedPhone).slice(-4);
        players[playerIndex]['희망종목'] = updatedEvent;
        players[playerIndex]['참가비현황'] = updatedFee;

        const now = new Date();
        const formattedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        
        players[playerIndex]['수정날짜'] = formattedDate;
        players[playerIndex]['수정자'] = adminInfo.adminName;

        savePlayerList(players, headers);
        return res.redirect(`/admin/players?adminName=${encodeURIComponent(adminName)}&updated=1`);
    }

    res.redirect(`/admin/players?adminName=${encodeURIComponent(adminName)}`);
});

module.exports = router;