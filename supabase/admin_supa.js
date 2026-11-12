const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx');

// 📌 server.js에서 전달받을 Supabase 인스턴스 관리
let supabaseInstance = null;
function setSupabase(client) {
    supabaseInstance = client;
}

/**
 * 날짜 포맷 변환 함수 (YYYY-MM-DD)
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
 * 📌 config.json 파일에서 전체 토탈 제한인원을 읽어오는 함수
 */
function getTotalMaxParticipantsConfig() {
    try {
        const filePath = path.join(__dirname, 'config.json');
        if (!fs.existsSync(filePath)) return 0;
        const fileData = fs.readFileSync(filePath, 'utf8');
        const config = JSON.parse(fileData);
        return Number(config['totalMaxParticipants'] || 0);
    } catch (error) {
        console.error("config.json totalMaxParticipants 읽기 오류:", error);
        return 0;
    }
}

/**
 * 📌 config.json 파일에서 모든 관리자 목록을 읽어오는 함수
 */
function getAllAdminConfigs() {
    try {
        const filePath = path.join(__dirname, 'config.json');
        if (!fs.existsSync(filePath)) return [];
        const fileData = fs.readFileSync(filePath, 'utf8');
        const row = JSON.parse(fileData);

        const admins = row['admins'] || [];
        return admins.map(admin => ({
            adminName: String(admin['adminName'] || '').trim(),
            adminPassword: String(admin['adminPassword'] || '').trim(),
            adminAuth: String(admin['adminAuth'] || '보기').trim()
        })).filter(admin => admin.adminName !== '');
    } catch (error) {
        console.error("관리자 설정 config.json 읽기 오류:", error);
        return [];
    }
}

/**
 * 📌 config.json 파일에서 모든 종목 및 제한인원 목록을 읽어오는 함수
 */
function getEventConfigs() {
    try {
        const filePath = path.join(__dirname, 'config.json');
        if (!fs.existsSync(filePath)) return [];
        const fileData = fs.readFileSync(filePath, 'utf8');
        const row = JSON.parse(fileData);

        const events = row['events'] || [];
        return events.map(ev => ({
            eventName: String(ev['eventName'] || '').trim(),
            maxParticipants: Number(ev['maxParticipants'] || 0),
            entryFee: Number(ev['entryFee'] || 0)
        })).filter(ev => ev.eventName !== '');
    } catch (error) {
        console.error("config.json 종목 읽기 오류:", error);
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
 * 📌 Supabase에서 '선수명단' 테이블을 안전하게 읽어오는 함수
 */
async function getPlayerListFromSupabase() {
    try {
        if (!supabaseInstance) {
            console.error("Supabase 인스턴스가 설정되지 않았습니다.");
            return [];
        }

        const { data, error } = await supabaseInstance
            .from('선수명단')
            .select('*');

        if (error) {
            console.error("Supabase 선수 명단 읽기 오류:", error);
            return [];
        }

        return data || [];
    } catch (error) {
        console.error("선수 명단 데이터 처리 오류:", error);
        return [];
    }
}

/**
 * 템플릿 렌더링 헬퍼 함수
 */
function renderTemplate(pageTitle, activeSection, data) {
    const templatePath = path.join(__dirname, 'admin.html');
    if (!fs.existsSync(templatePath)) {
        return `<h2>admin.html 템플릿 파일을 찾을 수 없습니다.</h2>`;
    }
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

// [GET] /admin - 대시보드 메인 화면
router.get('/', async (req, res) => {
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

    const players = await getPlayerListFromSupabase();
    const eventConfigs = getEventConfigs();
    const totalMax = getTotalMaxParticipantsConfig();
    const totalCount = players.length;

    const eventStats = {};
    eventConfigs.forEach(ec => {
        eventStats[ec.eventName] = { total: 0, paid: 0 };
    });

    let paidCount = 0;
    let unpaidCount = 0;
    let freeCount = 0;
    let canceledCount = 0;
    let unknownFeeCount = 0;

    players.forEach(player => {
        const feeStatus = String(player['참가비현황'] || '').trim();
        const phoneVal = String(player['연락처'] || '').trim();
        
        const isCanceled = feeStatus === '취소' || feeStatus === '환불완료' || phoneVal === '환불완료' || phoneVal === '취소됨';

        if (isCanceled) {
            canceledCount++;
        } else {
            const rawEvent = String(player['희망종목'] || '').trim();
            const matchedConfig = eventConfigs.find(ec => rawEvent === ec.eventName || rawEvent.includes(ec.eventName) || ec.eventName.includes(rawEvent));
            const eventKey = matchedConfig ? matchedConfig.eventName : (rawEvent || '미확인');

            if (!eventStats[eventKey]) {
                eventStats[eventKey] = { total: 0, paid: 0 };
            }

            eventStats[eventKey].total++;

            const isPaid = (feeStatus === '납부완료' || feeStatus === '완납' || feeStatus === '입금완료');
            if (isPaid) {
                eventStats[eventKey].paid++;
                paidCount++;
            } else if (feeStatus === '미납') {
                unpaidCount++;
            } else if (feeStatus === '무료' || feeStatus === '무료출전권') {
                freeCount++;
            } else {
                unknownFeeCount++;
            }
        }
    });

    const activeTotalCount = totalCount - canceledCount;

    const sortedEventEntries = Object.entries(eventStats).sort((a, b) => {
        if (a[0] === '미확인') return 1;
        if (b[0] === '미확인') return -1;
        return a[0].localeCompare(b[0], 'ko-KR', { numeric: true, sensitivity: 'base' });
    });

    let eventCardsHtml = '';
    if (sortedEventEntries.length > 0) {
        for (const [eventName, stats] of sortedEventEntries) {
            const cardHref = adminAuth === '보기' ? '#' : `/admin/players?adminName=${encodeURIComponent(currentAdminName)}&searchEvent=${encodeURIComponent(eventName)}`;
            const shortEventName = eventName.length > 3 ? eventName.substring(0, 3) : eventName;

            eventCardsHtml += `
                <a href="${cardHref}" class="stat-card-link">
                    <div class="stat-card event-card">
                        <h4 title="${eventName}">${shortEventName}</h4>
                        <div class="number">전체: ${stats.total} 명</div>
                        <div class="sub-number" style="font-size: 0.9rem; color: #2b8a3e; margin-top: 4px;">납부완료: ${stats.paid} 명</div>
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

    let closedModalHtml = '';
    if (totalMax > 0 && paidCount >= totalMax) {
        let ev1Paid = 0, ev2Paid = 0, ev3Paid = 0, ev4Paid = 0;
        
        for (const [eName, stats] of Object.entries(eventStats)) {
            if (eName.includes('1부')) ev1Paid += stats.paid;
            else if (eName.includes('2부')) ev2Paid += stats.paid;
            else if (eName.includes('3부')) ev3Paid += stats.paid;
            else if (eName.includes('4부')) ev4Paid += stats.paid;
        }

        closedModalHtml = `
            <div id="closedModal" style="display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0, 0, 0, 0.7); z-index: 9999; justify-content: center; align-items: center;">
                <div style="background-color: #dc3545; color: #ffffff; padding: 30px; border-radius: 15px; width: 90%; max-width: 420px; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); font-family: 'Noto Sans KR', sans-serif;">
                    <h2 style="margin-top: 0; margin-bottom: 20px; font-size: 26px; font-weight: bold; border-bottom: 2px solid rgba(255,255,255,0.3); padding-bottom: 12px;">
                        🚨 접수를 마감 합니다.
                    </h2>
                    
                    <div style="font-size: 18px; line-height: 1.8; text-align: left; background-color: rgba(0, 0, 0, 0.15); padding: 18px; border-radius: 10px; margin-bottom: 25px;">
                        <p style="margin: 4px 0; font-weight: bold; font-size: 19px; color: #ffeb3b;">전체인원 ${paidCount}명</p>
                        <hr style="border: 0; border-top: 1px solid rgba(255,255,255,0.3); margin: 10px 0;">
                        <p style="margin: 4px 0;">1부 ${ev1Paid}명</p>
                        <p style="margin: 4px 0;">2부 ${ev2Paid}명</p>
                        <p style="margin: 4px 0;">3부 ${ev3Paid}명</p>
                        <p style="margin: 4px 0;">4부 ${ev4Paid}명</p>
                    </div>

                    <button onclick="document.getElementById('closedModal').style.display='none'" style="background-color: #ffffff; color: #dc3545; border: none; padding: 12px 35px; font-size: 18px; font-weight: bold; border-radius: 8px; cursor: pointer; transition: 0.2s;">
                        확인
                    </button>
                </div>
            </div>
        `;
    }

    const alertDeniedHtml = req.query.denied ? '<div class="alert-denied">⚠️ 해당 기능에 접근할 수 없습니다. (현재 권한: 보기)</div>' : '';

    const html = renderTemplate('관리자 대시보드', 'DASHBOARD_SECTION', {
        CURRENT_ADMIN_NAME: currentAdminName,
        ADMIN_AUTH: adminAuth,
        ALERT_DENIED_HTML: alertDeniedHtml + closedModalHtml,
        TOTAL_COUNT: totalCount,
        CANCELED_COUNT: canceledCount,
        ACTIVE_TOTAL_COUNT: activeTotalCount,
        CANCELED_CARD_HREF: adminAuth === '보기' ? '#' : `/admin/players?adminName=${encodeURIComponent(currentAdminName)}&searchFee=취소`,
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
router.get('/players', async (req, res) => {
    const currentAdminName = String(req.query.adminName || '').trim();
    const adminInfo = getAdminByName(currentAdminName);
    const adminAuth = adminInfo ? adminInfo.adminAuth : '보기';

    if (adminAuth === '보기' || !adminInfo) {
        return res.redirect(`/admin?login=success&adminName=${encodeURIComponent(currentAdminName)}&denied=1`);
    }

    const players = await getPlayerListFromSupabase();
    const eventConfigs = getEventConfigs();

    const searchName = String(req.query.searchName || '').trim();
    const searchPhone4 = String(req.query.searchPhone4 || '').trim();
    const searchEvent = String(req.query.searchEvent || '').trim();
    const searchFee = String(req.query.searchFee || '').trim();

    const allEventsSet = new Set();
    eventConfigs.forEach(ec => allEventsSet.add(ec.eventName));
    players.forEach(p => {
        const rawEvt = String(p['희망종목'] || '').trim();
        if (rawEvt.length > 0) {
            allEventsSet.add(rawEvt);
        }
    });

    const filteredPlayers = players.filter(player => {
        if (searchName && !String(player['이름'] || '').includes(searchName)) return false;

        const pPhone = String(player['연락처'] || '').replace(/[^0-9]/g, '');
        const pPhone4 = String(player['연락처4'] || '').trim() || pPhone.slice(-4);
        if (searchPhone4 && !pPhone.includes(searchPhone4) && pPhone4 !== searchPhone4) return false;

        const pEvent = String(player['희망종목'] || '').trim();
        if (searchEvent) {
            if (searchEvent === '미확인' && pEvent.length > 0) return false;
            if (searchEvent !== '미확인' && !pEvent.includes(searchEvent) && !searchEvent.includes(pEvent)) return false;
        }

        const pFee = String(player['참가비현황'] || '').trim();
        const pPhoneVal = String(player['연락처'] || '').trim();
        const isPlayerCanceled = pFee === '취소' || pFee === '환불완료' || pPhoneVal === '환불완료' || pPhoneVal === '취소됨';

        if (searchFee) {
            if (searchFee === '납부완료' && !(pFee === '납부완료' || pFee === '완납' || pFee === '입금완료')) return false;
            if (searchFee === '미납' && pFee !== '미납') return false;
            if (searchFee === '무료출전권' && !(pFee === '무료' || pFee === '무료출전권')) return false;
            if ((searchFee === '환불완료' || searchFee === '취소') && !isPlayerCanceled) return false;
            if (searchFee === '미확인' && (pFee === '납부완료' || pFee === '완납' || pFee === '입금완료' || pFee === '미납' || pFee === '무료' || pFee === '무료출전권' || isPlayerCanceled)) return false;
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
        filteredPlayers.forEach((player, index) => {
            const name = player['이름'] || '';
            const phone = player['연락처'] || '';

            const rawRegDate = player['접수날짜'] || player['등록시간'] || '';
            const regDate = formatExcelDate(rawRegDate);

            let regDateFull = regDate;
            let regDateShort = regDate;
            if (regDate !== '-' && regDate.includes('-')) {
                const dateParts = regDate.split('-');
                if (dateParts.length >= 3) {
                    regDateShort = `${dateParts[1]}<br>${dateParts[2]}`;
                }
            }

            const currentFee = String(player['참가비현황'] || '').trim();
            const phoneVal = String(player['연락처'] || '').trim();
            const isCanceled = currentFee === '취소' || currentFee === '환불완료' || phoneVal === '환불완료' || phoneVal === '취소됨';
            const isUnpaid = currentFee === '미납';

            let rowStyle = '';
            if (isCanceled) {
                rowStyle = 'background-color: #adb5bd; color: #495057; text-decoration: line-through;';
            } else if (isUnpaid) {
                rowStyle = 'background-color: #f8d7da;';
            } else {
                const groupIndex = Math.floor(index / 3);
                rowStyle = groupIndex % 2 === 0 ? 'background-color: #ffffff;' : 'background-color: #eef6ff;';
            }

            const rawEvent = String(player['희망종목'] || '').trim();

            let itemEventOptions = '';
            allEventsList.forEach(evt => {
                const isSelected = (evt === rawEvent || rawEvent.includes(evt) || evt.includes(rawEvent));
                itemEventOptions += `<option value="${evt}" ${isSelected ? 'selected' : ''}>${evt}</option>`;
            });

            const feeList = ['납부완료', '미납', '무료출전권', '취소', '미확인'];
            let itemFeeOptions = '';
            feeList.forEach(f => {
                itemFeeOptions += `<option value="${f}" ${f === currentFee ? 'selected' : ''}>${f}</option>`;
            });

            playerRowsHtml += `
                <tr style="${rowStyle}">
                    <td>
                        <span class="date-full">${regDateFull}</span>
                        <span class="date-short">${regDateShort}</span>
                    </td>
                    <td><strong>${name}</strong></td>
                    <td>
                        <input type="text" name="phone_${index}" id="phone_${index}" value="${phone}" style="width: 110px; padding: 4px; text-align: center;" placeholder="취소시 0">
                    </td>
                    <td>
                        <select name="event_${index}" id="event_${index}" style="padding: 4px;">
                            ${itemEventOptions}
                        </select>
                    </td>
                    <td>
                        <select name="fee_${index}" id="fee_${index}" style="padding: 4px;">
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
router.get('/download-excel', async (req, res) => {
    const currentAdminName = String(req.query.adminName || '').trim();
    const adminInfo = getAdminByName(currentAdminName);
    const adminAuth = adminInfo ? adminInfo.adminAuth : '보기';

    if (adminAuth === '보기' || !adminInfo) {
        return res.redirect(`/admin?login=success&adminName=${encodeURIComponent(currentAdminName)}&denied=1`);
    }

    const players = await getPlayerListFromSupabase();

    const searchName = String(req.query.searchName || '').trim();
    const searchPhone4 = String(req.query.searchPhone4 || '').trim();
    const searchEvent = String(req.query.searchEvent || '').trim();
    const searchFee = String(req.query.searchFee || '').trim();

    const filteredPlayers = players.filter(player => {
        if (searchName && !String(player['이름'] || '').includes(searchName)) return false;

        const pPhone = String(player['연락처'] || '').replace(/[^0-9]/g, '');
        const pPhone4 = String(player['연락처4'] || '').trim() || pPhone.slice(-4);
        if (searchPhone4 && !pPhone.includes(searchPhone4) && pPhone4 !== searchPhone4) return false;

        const pEvent = String(player['희망종목'] || '').trim();
        if (searchEvent) {
            if (searchEvent === '미확인' && pEvent.length > 0) return false;
            if (searchEvent !== '미확인' && !pEvent.includes(searchEvent) && !searchEvent.includes(pEvent)) return false;
        }

        const pFee = String(player['참가비현황'] || '').trim();
        const pPhoneVal = String(player['연락처'] || '').trim();
        const isPlayerCanceled = pFee === '취소' || pFee === '환불완료' || pPhoneVal === '환불완료' || pPhoneVal === '취소됨';

        if (searchFee) {
            if (searchFee === '납부완료' && !(pFee === '납부완료' || pFee === '완납' || pFee === '입금완료')) return false;
            if (searchFee === '미납' && pFee !== '미납') return false;
            if (searchFee === '무료출전권' && !(pFee === '무료' || pFee === '무료출전권')) return false;
            if ((searchFee === '환불완료' || searchFee === '취소') && !isPlayerCanceled) return false;
            if (searchFee === '미확인' && (pFee === '납부완료' || pFee === '완납' || pFee === '입금완료' || pFee === '미납' || pFee === '무료' || pFee === '무료출전권' || isPlayerCanceled)) return false;
        }
        return true;
    });

    const worksheet = xlsx.utils.json_to_sheet(filteredPlayers);
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

// [POST] /admin/update-player - 개별 선수 정보 수정 및 연락처 '0' 입력 시 취소 처리
router.post('/update-player', async (req, res) => {
    const { adminName, name, phone, updatedPhone, updatedEvent, updatedFee } = req.body;
    const adminInfo = getAdminByName(adminName);
    const adminAuth = adminInfo ? adminInfo.adminAuth : '보기';

    if (adminAuth === '보기' || !adminInfo) {
        return res.redirect(`/admin?login=success&adminName=${encodeURIComponent(adminName)}&denied=1`);
    }

    try {
        if (!supabaseInstance) {
            console.error("Supabase 인스턴스가 설정되지 않았습니다.");
            return res.redirect(`/admin/players?adminName=${encodeURIComponent(adminName)}`);
        }

        const inputPhone = String(updatedPhone || '').trim();
        const now = new Date();
        const formattedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

        let updateData = {};

        if (inputPhone === '0' || inputPhone === '000') {
            updateData = {
                '연락처': '환불완료',
                '연락처4': '0000',
                '참가비현황': '취소',
                '수정날짜': formattedDate,
                '수정자': adminInfo.adminName
            };
        } else {
            const eventConfigs = getEventConfigs();
            const matchedConfig = eventConfigs.find(ec => updatedEvent === ec.eventName || updatedEvent.includes(ec.eventName) || ec.eventName.includes(updatedEvent));
            const targetEvent = matchedConfig ? matchedConfig.eventName : updatedEvent;

            updateData = {
                '연락처': inputPhone,
                '연락처4': String(inputPhone).replace(/[^0-9]/g, '').slice(-4),
                '희망종목': targetEvent,
                '참가비현황': updatedFee,
                '수정날짜': formattedDate,
                '수정자': adminInfo.adminName
            };
        }

        // Supabase에서 이름과 기존 연락처로 해당 선수 정보 업데이트
        const { error } = await supabaseInstance
            .from('선수명단')
            .update(updateData)
            .eq('이름', String(name).trim())
            .eq('연락처', String(phone).trim());

        if (error) {
            console.error("Supabase 선수 수정 실패:", error);
        }

        return res.redirect(`/admin/players?adminName=${encodeURIComponent(adminName)}&updated=1`);
    } catch (e) {
        console.error("선수 정보 수정 실패:", e);
        res.redirect(`/admin/players?adminName=${encodeURIComponent(adminName)}`);
    }
});

module.exports = {
    router,
    setSupabase
};

