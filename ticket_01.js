const { getKSTDate, validateRRN } = require('./utils'); 
const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();

// 📌 Supabase 클라이언트 연결 설정
const supabase = require('./supabase');


// ------------------------------------------------------------------
// 🛡️ [동시접속 데이터 유실 방지] 대기열(Queue) 및 순차 처리 로직
// ------------------------------------------------------------------
const registerQueue = []; // 접수 요청을 순서대로 저장할 대기열 배열
let isProcessingQueue = false; // 현재 저장 작업 중인지 나타내는 플래그

/**
 * 📌 config.json 파일에서 전체 토탈 제한인원을 읽어오는 헬퍼 함수
 */
function getTotalMaxParticipants() {
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
 * 📌 config.json 파일에서 모든 종목 및 제한인원 목록을 읽어오는 헬퍼 함수
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
 * 📌 대기열에 쌓인 접수건을 하나씩 꺼내어 순차적으로 수파베이스(swimmers 테이블)에 저장하는 함수
 */
async function processRegisterQueue() {
    if (isProcessingQueue || registerQueue.length === 0) {
        return;
    }

    isProcessingQueue = true;
    const task = registerQueue.shift();
    const { newRow, idNumber, name, desiredEvent, qs, res } = task;

    try {
        // 📌 수파베이스 swimmers 테이블에서 전체 데이터 가져오기
        const { data: dataRows, error: fetchError } = await supabase
            .from('swimmers')
            .select('*');

        if (fetchError) {
            console.error("수파베이스 데이터 조회 오류:", fetchError);
            throw fetchError;
        }

        const currentRows = dataRows || [];

        // 📌 config.json 파일에서 최신 종목 및 제한인원, 전체 제한인원 기준 동적 로드
        const totalMax = getTotalMaxParticipants();
        const configRows = getEventConfigs();
        
        let targetEventName = '';
        let matchedMax = 0;
        let isValidEvent = false;

        configRows.forEach(cr => {
            const evName = cr.eventName;
            const evMax = cr.maxParticipants;
            if (evName && (desiredEvent === evName || desiredEvent.includes(evName) || evName.includes(desiredEvent))) {
                isValidEvent = true;
                targetEventName = evName;
                matchedMax = evMax;
            }
        });

        // 📌 1. config.json에 없는 종목인 경우 차단
        if (!isValidEvent) {
            return res.send(`<script>alert('존재하지 않거나 올바르지 않은 종목입니다.'); window.location.href='/register${qs}';</script>`);
        }

        // 📌 2. '입금완료' 인원 기준 전체 제한인원 및 종목별 제한인원 초과 마감 재검증
        let totalPaidCount = 0;
        let eventPaidCount = 0;

        currentRows.forEach(row => {
            const ev = String(row['desired_event'] || '').trim();
            const status = String(row['entry_fee_status'] || '').trim();
            if (status === '입금완료') {
                totalPaidCount++;
                if (ev === targetEventName || ev.includes(targetEventName) || targetEventName.includes(ev)) {
                    eventPaidCount++;
                }
            }
        });

        // 2-1. 전체 대회 총 정원(totalMaxParticipants) 초과 검증
        if (totalMax > 0 && totalPaidCount >= totalMax) {
            return res.send(`<script>alert('관리자의 확인이 필요합니다.'); window.location.href='/register${qs}';</script>`);
        }

        // 2-2. 개별 종목 제한인원(maxParticipants) 초과 검증
        if (matchedMax > 0 && eventPaidCount >= matchedMax) {
            return res.send(`<script>alert('관리자의 확인이 필요합니다.'); window.location.href='/register${qs}';</script>`);
        }

        // 📌 3. 중복 접수 체크 (이름과 주민등록번호 동시 일치 여부 확인)
        const isAlreadyRegistered = currentRows.some(row => {
            return String(row['name'] || '').trim() === name && String(row['rrn'] || '').trim() === idNumber;
        });

        if (isAlreadyRegistered) {
            res.send(`<script>alert('이미 접수된 사용자입니다. (이름과 주민등록번호가 일치합니다.)'); window.location.href='/register${qs}';</script>`);
        } else {
            // config.json의 정확한 종목명으로 보정하여 저장
            newRow['desired_event'] = targetEventName;

            // 수파베이스 swimmers 테이블에 저장 (INSERT)
            const { error: insertError } = await supabase
                .from('swimmers')
                .insert([newRow]);

            if (insertError) {
                console.error("수파베이스 저장 오류:", insertError);
                throw insertError;
            }

            res.send(`<script>alert('접수가 완료되었습니다!'); window.location.href = '/';</script>`);
        }
    } catch (error) {
        console.error("수파베이스 저장 중 오류 발생:", error);
        res.send(`
            <script>
                alert('접수 처리 중 일시적인 오류가 발생했습니다. 다시 시도해 주세요.');
                window.location.href = '/register${qs}';
            </script>
        `);
    } finally {
        isProcessingQueue = false;
        if (registerQueue.length > 0) {
            setImmediate(processRegisterQueue);
        }
    }
}

/**
 * 📌 메인 입력 화면 (GET /register)
 * - config.json의 종목명과 제한인원을 동적으로 읽어와 폼을 생성합니다.
 */
router.get('/', async (req, res) => {
    const old = req.query || {};

    const totalMax = getTotalMaxParticipants();
    const configRows = getEventConfigs();
    let dataRows = [];
    try {
        const { data, error } = await supabase
            .from('swimmers')
            .select('*');
        if (!error && data) {
            dataRows = data;
        }
    } catch (e) {
        console.error("접수 화면 데이터 읽기 오류:", e);
    }

    // 선수명단에서 '입금완료' 상태인 인원 집계 (종목별 및 전체 총합)
    const paidCounts = {};
    let totalPaidCount = 0;
    dataRows.forEach(row => {
        const ev = String(row['desired_event'] || '').trim();
        const status = String(row['entry_fee_status'] || '').trim();
        if (status === '입금완료') {
            totalPaidCount++;
            if (ev) {
                paidCounts[ev] = (paidCounts[ev] || 0) + 1;
            }
        }
    });

    const checkMatch = (val, target) => {
        const v = String(val || '').trim();
        const t = String(target || '').trim();
        return v === t || v.includes(t) || t.includes(v);
    };

    // 📌 config.json 기반 동적 종목 라디오 버튼 생성
    let eventRadiosHtml = '';
    if (configRows.length > 0) {
        configRows.forEach((cr, index) => {
            const evName = cr.eventName;
            if (!evName) return;
            const evMax = cr.maxParticipants;

            let currentPaid = 0;
            for (const [ev, count] of Object.entries(paidCounts)) {
                if (ev === evName || ev.includes(evName) || evName.includes(ev)) {
                    currentPaid += count;
                }
            }

            // 전체 제한인원이 찼거나, 개별 종목 제한인원이 찬 경우 마감
            const isTotalFull = (totalMax > 0 && totalPaidCount >= totalMax);
            const isEventFull = (evMax > 0 && currentPaid >= evMax);
            const isFull = isTotalFull || isEventFull;

            const isChecked = checkMatch(old.desiredEvent, evName) || (!old.desiredEvent && index === 0 && !isFull);
            const badge = isFull ? ' (관리자의 확인이 필요 합니다.)' : '';

            eventRadiosHtml += `
                <div style="margin-bottom: 8px;">
                    <label class="radio-label" style="${isFull ? 'opacity: 0.6; color: #888; cursor: not-allowed;' : 'cursor: pointer;'}">
                        <input type="radio" name="desiredEvent" value="${evName}" ${isChecked ? 'checked' : ''} ${isFull ? 'disabled' : ''} required onclick="${isFull ? "alert('관리자의 확인이 필요합니다.'); return false;" : ""}"> 
                        ${evName}${badge}
                    </label>
                </div>
            `;
        });
    } else {
        eventRadiosHtml = `<p style="color: red;">config.json 파일에 등록된 종목이 없습니다.</p>`;
    }

    res.send(`
        <!DOCTYPE html>
        <html lang="ko">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>2026 아쿠아 마라톤 참가 접수</title>
            <link rel="stylesheet" href="/style.css">
            <style>
                input:focus, textarea:focus {
                    background-color: #ffffe0 !important;
                    outline: 2px solid #ffc107;
                }
                input::placeholder, textarea::placeholder {
                    color: #999;
                    transition: color 0.2s;
                }
                input:focus::placeholder, textarea:focus::placeholder {
                    color: transparent;
                }
            </style>
            <script>
                function toggleClubInput(hasClub) {
                    const clubInput = document.getElementById('club');
                    if (hasClub === 'yes') {
                        clubInput.disabled = false;
                        clubInput.required = true;
                    } else {
                        clubInput.disabled = true;
                        clubInput.value = '';
                        clubInput.required = false;
                    }
                }

                function toggleMedicalInput(hasMedical) {
                    const memoInput = document.getElementById('memo');
                    if (hasMedical === 'yes') {
                        memoInput.disabled = false;
                        memoInput.required = true;
                    } else {
                        memoInput.disabled = true;
                        memoInput.value = '';
                        memoInput.required = false;
                    }
                }

                window.onload = function() {
                    const hasClubYes = document.querySelector('input[name="hasClub"][value="yes"]');
                    if (hasClubYes && hasClubYes.checked) toggleClubInput('yes');

                    const hasMedicalYes = document.querySelector('input[name="hasMedical"][value="yes"]');
                    if (hasMedicalYes && hasMedicalYes.checked) toggleMedicalInput('yes');
                };
            </script>
        </head>
        <body>
            <div class="container">
                <h2>2026 아쿠아 마라톤 참가 접수</h2>
                <form action="/register/search" method="POST">
                    <!-- 1. 이름 입력 -->
                    <div class="form-group">
                        <label for="name">1. 이름 </label>
                        <input type="text" id="name" name="name" required placeholder="(띄어쓰기 없이)" value="${old.name || ''}" oninput="this.value=this.value.replace(/\\s/g,'')">
                    </div>
                    
                    <!-- 2. 성별 선택 -->
                    <div class="form-group">
                        <label>2. 성별</label>
                        <div class="radio-group">
                            <label class="radio-label"><input type="radio" name="gender" value="남자" ${old.gender === '남자' ? 'checked' : ''} required> 남자</label>
                            <label class="radio-label"><input type="radio" name="gender" value="여자" ${old.gender === '여자' ? 'checked' : ''}> 여자</label>
                        </div>
                    </div>

                    <!-- 3. 주민등록번호 입력 -->
                    <div class="form-group">
                        <label for="idNumber">3. 주민등록번호 <br> (숫자 13자리 입력 , - 생략)</label>
                        <input type="text" id="idNumber" name="idNumber" required maxlength="13" placeholder="예: 9912311234567" value="${old.idNumber || ''}" inputmode="numeric" oninput="this.value=this.value.replace(/[^0-9]/g,'')">
                    </div>

                    <!-- 4. 연락처 입력 -->
                    <div class="form-group">
                        <label for="phone">4. 연락처 <br>(숫자만 입력)</label>
                        <input type="text" id="phone" name="phone" required maxlength="12" placeholder="예: 01012341234" value="${old.phone || ''}" inputmode="numeric" oninput="this.value=this.value.replace(/[^0-9]/g,'')">
                    </div>

                    <!-- 5. 주소 입력 -->
                    <div class="form-group">
                        <label for="address">5. 주소 (선택 입력)</label>
                        <input type="text" id="address" name="address" placeholder="생략 가능" value="${old.address || ''}">
                    </div>

                    <!-- 6. 소속클럽 입력 -->
                    <div class="form-group">
                        <label>6. 소속클럽 여부</label>
                        <div class="radio-group">
                            <label class="radio-label"><input type="radio" name="hasClub" value="no" ${!old.hasClub || old.hasClub === 'no' ? 'checked' : ''} onclick="toggleClubInput('no')"> 없음</label>
                            <label class="radio-label"><input type="radio" name="hasClub" value="yes" ${old.hasClub === 'yes' ? 'checked' : ''} onclick="toggleClubInput('yes')"> 있음</label>
                        </div>
                    </div>

                    <div class="form-group">
                        <label for="club">소속클럽명</label>
                        <input type="text" id="club" name="club" placeholder="클럽이 있는경우 입력" value="${old.club || ''}" disabled>
                    </div>

                    <!-- 7. 희망종목 선택 (config.json 연동) -->
                    <div class="form-group">
                        <label>7. 희망종목</label>
                        <div class="radio-group">
                            ${eventRadiosHtml}
                        </div>
                    </div>

                    <!-- 8. 예상기록 입력 -->
                    <div class="form-group">
                        <label for="expectedTime">8. 예상기록 <br>(예:11030 = 1:10:30)</label>
                        <input type="text" id="expectedTime" name="expectedTime" required maxlength="5" placeholder="5자리 입력 (예: 11030)" value="${old.expectedTime || ''}" inputmode="numeric" oninput="this.value=this.value.replace(/[^0-9]/g,'')">
                    </div>

                    <!-- 9. 보호자 이름 입력 -->
                    <div class="form-group">
                        <label for="guardianName">9. 보호자 이름 </label>
                        <input type="text" id="guardianName" name="guardianName" required placeholder="(띄어쓰기 없이)" value="${old.guardianName || ''}" oninput="this.value=this.value.replace(/\\s/g,'')">
                    </div>

                    <!-- 10. 보호자 연락처 입력 -->
                    <div class="form-group">
                        <label for="guardianPhone">10. 보호자 연락처 <br>(숫자 입력)</label>
                        <input type="text" id="guardianPhone" name="guardianPhone" required maxlength="12" placeholder="예: 01012341234" value="${old.guardianPhone || ''}" inputmode="numeric" oninput="this.value=this.value.replace(/[^0-9]/g,'')">
                    </div>

                    <!-- 11. 질병유무 입력 -->
                    <div class="form-group">
                        <label>11. 질병유무</label>
                        <div class="radio-group">
                            <label class="radio-label"><input type="radio" name="hasMedical" value="no" ${!old.hasMedical || old.hasMedical === 'no' ? 'checked' : ''} onclick="toggleMedicalInput('no')"> 없음</label>
                            <label class="radio-label"><input type="radio" name="hasMedical" value="yes" ${old.hasMedical === 'yes' ? 'checked' : ''} onclick="toggleMedicalInput('yes')"> 있음</label>
                        </div>
                    </div>

                    <div class="form-group">
                        <label for="memo">기타 사항 (질병 유무가 있는 경우 작성)</label>
                        <textarea id="memo" name="memo" placeholder="상세 내용을 적어주세요" disabled>${old.memo || ''}</textarea>
                    </div>

                    <!-- 12. 기념품 선택 -->
                    <div class="form-group">
                        <label>12. 기념품 (셔츠 사이즈)</label>
                        <div class="radio-group">
                            <label class="radio-label"><input type="radio" name="souvenir1" value="S (85 ~ 90)" ${old.souvenir1 === 'S (85 ~ 90)' ? 'checked' : ''} required> S (85 ~ 90)</label>
                            <label class="radio-label"><input type="radio" name="souvenir1" value="M (95 ~ 100)" ${old.souvenir1 === 'M (95 ~ 100)' ? 'checked' : ''}> M (95 ~ 100)</label>
                            <label class="radio-label"><input type="radio" name="souvenir1" value="L (100 ~ 105)" ${old.souvenir1 === 'L (100 ~ 105)' ? 'checked' : ''}> L (100 ~ 105)</label>
                            <label class="radio-label"><input type="radio" name="souvenir1" value="XL (105 ~ 110)" ${old.souvenir1 === 'XL (105 ~ 110)' ? 'checked' : ''}> XL (105 ~ 110)</label>
                            <label class="radio-label"><input type="radio" name="souvenir1" value="XXL (110 ~ 115)" ${old.souvenir1 === 'XXL (110 ~ 115)' ? 'checked' : ''}> XXL (110 ~ 115)</label>
                        </div>
                    </div>

                    <!-- 13. 홍보동의여부 선택 -->
                    <div class="form-group">
                        <label>13. 홍보동의여부</label>
                        <div class="radio-group">
                            <label class="radio-label"><input type="radio" name="marketingConsent" value="받고 싶다" ${!old.marketingConsent || old.marketingConsent === '받고 싶다' ? 'checked' : ''} required> 받고 싶다</label>
                            <label class="radio-label"><input type="radio" name="marketingConsent" value="받고 싶지 않다" ${old.marketingConsent === '받고 싶지 않다' ? 'checked' : ''}> 받고 싶지 않다</label>
                        </div>
                    </div>

                    <button type="submit">접수하기</button>
                </form>
                <a href="/" style="display:block; text-align:center; margin-top:20px; text-decoration:none; background-color:#6c757d; color:white; height:75px; line-height:75px; border-radius:10px; font-size:26px; font-weight:bold;">메인으로 돌아가기</a>
            </div>
        </body>
        </html>
    `);
});

/**
 * 📌 접수 데이터 처리 (POST /register/search)
 */
router.post('/search', (req, res) => {
    const getQueryString = (body) => {
        return Object.keys(body)
            .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(body[key] || ''))
            .join('&');
    };

    const formatPhone = (num) => {
        const cleaned = (num || '').replace(/[^0-9]/g, '');
        if (cleaned.length === 11) return cleaned.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3');
        if (cleaned.length === 10) return cleaned.startsWith('02') ? cleaned.replace(/(\d{2})(\d{4})(\d{4})/, '$1-$2-$3') : cleaned.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
        if (cleaned.length === 8) return cleaned.replace(/(\d{4})(\d{4})/, '$1-$2');
        return cleaned;
    };

    const formatTime = (timeStr) => {
        const cleaned = (timeStr || '').replace(/[^0-9]/g, '');
        if (cleaned.length === 5) {
            const h = cleaned.slice(0, 1);
            const m = cleaned.slice(1, 3);
            const s = cleaned.slice(3, 5);
            return `${h}:${m}:${s}`;
        }
        return timeStr;
    };

    const name = (req.body.name || '').trim();
    const gender = req.body.gender || '';
    const rawIdNumber = (req.body.idNumber || '').trim();
    const rawPhone = (req.body.phone || '').trim();
    const address = (req.body.address || '').trim();
    const hasClub = req.body.hasClub || 'no';
    const club = hasClub === 'yes' ? (req.body.club || '').trim() : '없음';
    const desiredEvent = req.body.desiredEvent || '';
    const rawExpectedTime = (req.body.expectedTime || '').trim();
    const guardianName = (req.body.guardianName || '').trim();
    const rawGuardianPhone = (req.body.guardianPhone || '').trim();
    const hasMedical = req.body.hasMedical || 'no';
    const memo = hasMedical === 'yes' ? (req.body.memo || '').trim() : '없음';
    const souvenir1 = req.body.souvenir1 || '';
    const marketingConsent = req.body.marketingConsent || '';
    const entryFee = '미확인';

    const phone = formatPhone(rawPhone);
    const guardianPhone = formatPhone(rawGuardianPhone);
    const phone4 = rawPhone.slice(-4);
    const expectedTime = formatTime(rawExpectedTime);
    const idNumber = rawIdNumber.length === 13 ? `${rawIdNumber.slice(0, 6)}-${rawIdNumber.slice(6)}` : rawIdNumber;

    const qs = '?' + getQueryString(req.body);

    if (!name) return res.send(`<script>alert('이름을 입력해 주세요.'); window.location.href='/register${qs}';</script>`);
    if (!gender) return res.send(`<script>alert('성별을 선택해 주세요.'); window.location.href='/register${qs}';</script>`);
    if (!rawIdNumber) return res.send(`<script>alert('주민등록번호를 입력해 주세요.'); window.location.href='/register${qs}';</script>`);
    if (!rawPhone) return res.send(`<script>alert('연락처를 입력해 주세요.'); window.location.href='/register${qs}';</script>`);
    if (hasClub === 'yes' && !club) return res.send(`<script>alert('소속클럽명을 입력해 주세요.'); window.location.href='/register${qs}';</script>`);
    if (!desiredEvent) return res.send(`<script>alert('희망종목를 선택해 주세요.'); window.location.href='/register${qs}';</script>`);
    if (!rawExpectedTime) return res.send(`<script>alert('예상기록을 입력해 주세요.'); window.location.href='/register${qs}';</script>`);
    if (!guardianName) return res.send(`<script>alert('보호자 이름을 입력해 주세요.'); window.location.href='/register${qs}';</script>`);
    if (!rawGuardianPhone) return res.send(`<script>alert('보호자 연락처를 입력해 주세요.'); window.location.href='/register${qs}';</script>`);
    if (hasMedical === 'yes' && !memo) return res.send(`<script>alert('질병 내용을 입력해 주세요.'); window.location.href='/register${qs}';</script>`);
    if (!souvenir1) return res.send(`<script>alert('기념품(셔츠 사이즈)을 선택해 주세요.'); window.location.href='/register${qs}';</script>`);
    if (!marketingConsent) return res.send(`<script>alert('홍보동의여부를 선택해 주세요.'); window.location.href='/register${qs}';</script>`);

    if (rawIdNumber.length !== 13) {
        return res.send(`<script>alert('주민등록번호는 숫자 13자리여야 합니다.'); window.location.href='/register${qs}';</script>`);
    }

    if (!validateRRN(rawIdNumber)) {
        return res.send(`<script>alert('유효하지 않은 주민등록번호입니다. 정확한 번호를 입력해 주세요.'); window.location.href='/register${qs}';</script>`);
    }

    if (rawPhone.length < 8 || rawPhone.length > 12) {
        return res.send(`<script>alert('연락처는 숫자 8~12자리여야 합니다.'); window.location.href='/register${qs}';</script>`);
    }
    if (rawGuardianPhone.length < 8 || rawGuardianPhone.length > 12) {
        return res.send(`<script>alert('보호자 연락처는 숫자 8~12자리여야 합니다.'); window.location.href='/register${qs}';</script>`);
    }
    if (rawExpectedTime.length !== 5) {
        return res.send(`<script>alert('예상기록은 HMMSS 형식의 숫자 5자리여야 합니다.'); window.location.href='/register${qs}';</script>`);
    }

    const now = getKSTDate();
    const regDate = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;

    // 📌 수파베이스 컬럼 매칭 (영문 컬럼명)
    const newRow = {
        name: name,
        gender: gender,
        rrn: idNumber,
        phone: phone,
        phone4: phone4,
        entry_fee_status: entryFee,
        address: address,
        club: club,
        desired_event: desiredEvent,
        expected_time: expectedTime,
        guardian_name: guardianName,
        guardian_phone: guardianPhone,
        medical_memo: memo,
        souvenir1: souvenir1,
        souvenir2: '',
        marketing_consent: marketingConsent,
        notes: '',
        registered_at: regDate
    };

    registerQueue.push({ newRow, idNumber, name, desiredEvent, qs, res });
    processRegisterQueue();
});

module.exports = router;