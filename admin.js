const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx');

// 📌 수파베이스 클라이언트 연결 설정
const supabase = require('./supabase');

// 📌 공통 한국 시간(KST) 구하기 도구 함수 불러오기
const { getKSTDate } = require('./utils');

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
 * 📌 수파베이스 swimmers 테이블에서 전체 선수 데이터 가져오는 헬퍼 함수
 */
async function getPlayerListFromSupabase() {
    try {
        const { data, error } = await supabase
            .from('swimmers')
            .select('*');

        if (error) {
            console.error("수파베이스 선수 목록 읽기 오류:", error);
            return [];
        }
        return data || [];
    } catch (error) {
        console.error("수파베이스 읽기 예외 오류:", error);
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
        const feeStatus = String(player['entry_fee_status'] || '').trim();
        const phoneVal = String(player['phone'] || '').trim();
        
        const isCanceled = feeStatus === '취소' || feeStatus === '환불완료' || phoneVal === '환불완료' || phoneVal === '취소됨';

        if (isCanceled) {
            canceledCount++;
        } else {
            const rawEvent = String(player['desired_event'] || '').trim();
            const matchedConfig = eventConfigs.find(ec => ec.eventName === rawEvent) || 
                                  eventConfigs.find(ec => rawEvent.includes(ec.eventName));
            const eventKey = matchedConfig ? matchedConfig.eventName : (rawEvent || '미확인');

            if (!eventStats[eventKey]) {
                eventStats[eventKey] = { total: 0, paid: 0 };
            }

            eventStats[eventKey].total++;

            const isPaid = (feeStatus === '입금완료' || feeStatus === '완납');
            if (isPaid) {
                eventStats[eventKey].paid++;
                paidCount++;
            } else if (feeStatus === '미입금') {
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
                        <div class="sub-number" style="font-size: 0.9rem; color: #2b8a3e; margin-top: 4px;">입금완료: ${stats.paid} 명</div>
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
            if (eName === '1부' || eName.startsWith('1부 ')) ev1Paid += stats.paid;
            else if (eName === '2부' || eName.startsWith('2부 ')) ev2Paid += stats.paid;
            else if (eName === '3부' || eName.startsWith('3부 ')) ev3Paid += stats.paid;
            else if (eName === '4부' || eName.startsWith('4부 ')) ev4Paid += stats.paid;
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
        CANCELED_CARD_HREF: adminAuth === '보기' ? '#' : `/admin/players?adminName=${encodeURIComponent(currentAdminName)}&searchFee=환불완료`,
        EVENT_CARDS_HTML: eventCardsHtml,
        PAID_CARD_HREF: adminAuth === '보기' ? '#' : `/admin/players?adminName=${encodeURIComponent(currentAdminName)}&searchFee=입금완료`,
        PAID_COUNT: paidCount,
        UNPAID_CARD_HREF: adminAuth === '보기' ? '#' : `/admin/players?adminName=${encodeURIComponent(currentAdminName)}&searchFee=미입금`,
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
        const rawEvt = String(p['desired_event'] || '').trim();
        if (rawEvt.length > 0) {
            allEventsSet.add(rawEvt);
        }
    });

    const filteredPlayers = players.filter(player => {
        if (searchName && !String(player['name'] || '').includes(searchName)) return false;

        const pPhone = String(player['phone'] || '').replace(/[^0-9]/g, '');
        const pPhone4 = String(player['phone4'] || '').trim() || pPhone.slice(-4);
        if (searchPhone4 && !pPhone.includes(searchPhone4) && pPhone4 !== searchPhone4) return false;

        const pEvent = String(player['desired_event'] || '').trim();
        if (searchEvent) {
            if (searchEvent === '미확인' && pEvent.length > 0) return false;
            if (searchEvent !== '미확인' && !pEvent.includes(searchEvent) && !searchEvent.includes(pEvent)) return false;
        }

        const pFee = String(player['entry_fee_status'] || '').trim();
        const pPhoneVal = String(player['phone'] || '').trim();
        const isPlayerCanceled = pFee === '취소' || pFee === '환불완료' || pPhoneVal === '환불완료' || pPhoneVal === '취소됨';

        if (searchFee) {
            if (searchFee === '입금완료' && !(pFee === '입금완료' || pFee === '완납')) return false;
            if (searchFee === '미입금' && pFee !== '미입금') return false;
            if (searchFee === '무료출전권' && !(pFee === '무료' || pFee === '무료출전권')) return false;
            if ((searchFee === '환불완료' || searchFee === '취소') && !isPlayerCanceled) return false;
            if (searchFee === '미확인' && (pFee === '입금완료' || pFee === '완납' || pFee === '미입금' || pFee === '무료' || pFee === '무료출전권' || isPlayerCanceled)) return false;
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
            const name = player['name'] || '';
            const phone = player['phone'] || '';

            const rawRegDate = player['registered_at'] || player['checkin_time'] || '';
            const regDate = formatExcelDate(rawRegDate);

            let regDateFull = regDate;
            let regDateShort = regDate;
            if (regDate !== '-' && regDate.includes('-')) {
                const dateParts = regDate.split('-');
                if (dateParts.length >= 3) {
                    regDateShort = `${dateParts[1]}<br>${dateParts[2]}`;
                }
            }

            const currentFee = String(player['entry_fee_status'] || '').trim();
            const phoneVal = String(player['phone'] || '').trim();
            const isCanceled = currentFee === '취소' || currentFee === '환불완료' || phoneVal === '환불완료' || phoneVal === '취소됨';
            const isUnpaid = currentFee === '미입금';

            let rowStyle = '';
            if (isCanceled) {
                rowStyle = 'background-color: #495057; color: #ffffff;';
            } else if (isUnpaid) {
                rowStyle = 'background-color: #f8d7da;';
            } else {
                const groupIndex = Math.floor(index / 3);
                rowStyle = groupIndex % 2 === 0 ? 'background-color: #ffffff;' : 'background-color: #eef6ff;';
            }

            const rawEvent = String(player['desired_event'] || '').trim();

            let itemEventOptions = '';
            allEventsList.forEach(evt => {
                const isSelected = (evt === rawEvent || rawEvent.includes(evt) || evt.includes(rawEvent));
                itemEventOptions += `<option value="${evt}" ${isSelected ? 'selected' : ''}>${evt}</option>`;
            });

            const feeList = ['입금완료', '미입금', '무료출전권', '환불완료', '미확인'];
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
                        <input type="text" name="phone_${index}" id="phone_${index}" value="${phone}" style="width: 110px; padding: 4px; text-align: center;" placeholder="환불시 0">
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
                            <input type="hidden" name="id" value="${player.id}">
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
        FEE_SELECTED_PAID: searchFee === '입금완료' ? 'selected' : '',
        FEE_SELECTED_UNPAID: searchFee === '미입금' ? 'selected' : '',
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
        if (searchName && !String(player['name'] || '').includes(searchName)) return false;

        const pPhone = String(player['phone'] || '').replace(/[^0-9]/g, '');
        const pPhone4 = String(player['phone4'] || '').trim() || pPhone.slice(-4);
        if (searchPhone4 && !pPhone.includes(searchPhone4) && pPhone4 !== searchPhone4) return false;

        const pEvent = String(player['desired_event'] || '').trim();
        if (searchEvent) {
            if (searchEvent === '미확인' && pEvent.length > 0) return false;
            if (searchEvent !== '미확인' && !pEvent.includes(searchEvent) && !searchEvent.includes(pEvent)) return false;
        }

        const pFee = String(player['entry_fee_status'] || '').trim();
        const pPhoneVal = String(player['phone'] || '').trim();
        const isPlayerCanceled = pFee === '취소' || pFee === '환불완료' || pPhoneVal === '환불완료' || pPhoneVal === '취소됨';

        if (searchFee) {
            if (searchFee === '입금완료' && !(pFee === '입금완료' || pFee === '완납')) return false;
            if (searchFee === '미입금' && pFee !== '미입금') return false;
            if (searchFee === '무료출전권' && !(pFee === '무료' || pFee === '무료출전권')) return false;
            if ((searchFee === '환불완료' || searchFee === '취소') && !isPlayerCanceled) return false;
            if (searchFee === '미확인' && (pFee === '입금완료' || pFee === '완납' || pFee === '미입금' || pFee === '무료' || pFee === '무료출전권' || isPlayerCanceled)) return false;
        }
        return true;
    });

    const exportData = filteredPlayers.map(p => ({
        '대회날짜': p.competitionDate || '',
        '접수날짜': p.registered_at || '',
        '등록순서': p.id_no || '',
        '이름': p.name || '',
        '참가비현황': p.entry_fee_status || '',
        '연락처': p.phone || '',
        '연락처4': p.phone4 || '',
        '성별': p.gender || '',
        '소속클럽': p.club || '',
        '주민등록번호': p.rrn || '',
        '보호자이름': p.guardian_name || '',
        '보호자연락처': p.guardian_phone || '',
        '희망종목': p.desired_event || '',
        '예상기록': p.expected_time || '',
        '질병유무': p.medical_memo || '',
        '기념품1': p.souvenir1 || '',
        '홍보동의여부': p.marketing_consent || '',
        '주소': p.address || '',
        '종목': p.game || '',
        '경기번호': p.match_no || '',
        '등록시간': p.checkin_time || '',
        '경기시간': p.entry_time || '',
        '레인번호': p.lane_no || '',
        '출발순서': p.startOrder || '',
        '출발시간': p.startTime || '',
        '출수시간': p.exitTime || '',
        '완주시간': p.finishTime || '',
        '기타': p.notes || '',
        '기념품2': p.souvenir2 || '',
        '등번호': p.bib_no || '',
        '수정날짜': p.updated_at_custom || '',
        '수정자': p.updated_by || ''
    }));

    const worksheet = xlsx.utils.json_to_sheet(exportData);
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

// [POST] /admin/update-player - 개별 선수 정보 수정 및 연락처 '0' 입력 시 환불완료 처리
router.post('/update-player', async (req, res) => {
    const { adminName, id, name, phone, updatedPhone, updatedEvent, updatedFee } = req.body;
    const adminInfo = getAdminByName(adminName);
    const adminAuth = adminInfo ? adminInfo.adminAuth : '보기';

    if (adminAuth === '보기' || !adminInfo) {
        return res.redirect(`/admin?login=success&adminName=${encodeURIComponent(adminName)}&denied=1`);
    }

    try {
        const players = await getPlayerListFromSupabase();

        const rawTargetPhone = String(phone || '').replace(/[^0-9]/g, '');
        const targetPlayer = players.find(p => {
            if (id && String(p.id) === String(id)) return true;
            const pNameMatches = String(p['name'] || '').trim() === String(name).trim();
            const pPhoneRaw = String(p['phone'] || '').replace(/[^0-9]/g, '');
            return pNameMatches && (pPhoneRaw === rawTargetPhone || rawTargetPhone === '');
        });

        if (targetPlayer) {
            const inputPhone = String(updatedPhone || '').trim();
            const updatePayload = {};

            if (inputPhone === '0' || inputPhone === '000') {
                updatePayload['phone'] = phone;
                updatePayload['phone4'] = String(phone).replace(/[^0-9]/g, '').slice(-4);
                updatePayload['entry_fee_status'] = '환불완료';
            } else {
                updatePayload['phone'] = inputPhone;
                updatePayload['phone4'] = String(inputPhone).replace(/[^0-9]/g, '').slice(-4);
                
                const eventConfigs = getEventConfigs();
                const matchedConfig = eventConfigs.find(ec => updatedEvent === ec.eventName || updatedEvent.includes(ec.eventName) || ec.eventName.includes(updatedEvent));
                updatePayload['desired_event'] = matchedConfig ? matchedConfig.eventName : updatedEvent;

                updatePayload['entry_fee_status'] = updatedFee;
            }

            const now = getKSTDate();
            const formattedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
            
            updatePayload['updated_at_custom'] = formattedDate;
            updatePayload['updated_by'] = adminInfo.adminName;

            const { error: updateError } = await supabase
                .from('swimmers')
                .update(updatePayload)
                .eq('id', targetPlayer.id);

            if (updateError) {
                console.error("관리자 선수 수정 수파베이스 업데이트 오류:", updateError);
                throw updateError;
            }

            return res.redirect(`/admin/players?adminName=${encodeURIComponent(adminName)}&updated=1`);
        }
    } catch (error) {
        console.error("관리자 선수 수정 오류:", error);
    }

    res.redirect(`/admin/players?adminName=${encodeURIComponent(adminName)}`);
});

module.exports = router;