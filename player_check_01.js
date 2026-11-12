const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();

// 📌 Supabase 클라이언트 연결 설정
const supabase = require('./supabase');


// 📌 공통 한국 시간(KST) 구하기 도구 함수 불러오기
const { getKSTDate } = require('./utils');

/**
 * 📌 config.json 파일에서 설정 정보를 읽어오는 헬퍼 함수
 */
function getConfig() {
    try {
        const filePath = path.join(__dirname, 'config.json');
        if (!fs.existsSync(filePath)) return {};
        const fileData = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(fileData);
    } catch (error) {
        console.error("config.json 읽기 오류:", error);
        return {};
    }
}

/**
 * 📌 메인 입력 화면 (GET /entry) -> 신청자 조회 폼
 */
router.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="ko">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>신청자 조회</title>
            <link rel="stylesheet" href="/style.css">
        </head>
        <body>
            <div class="container">
                <h2>신청자 조회</h2>
                <form action="/entry/search" method="POST">
                    <div class="form-group">
                        <label for="name">이름</label>
                        <input type="text" id="name" name="name" required placeholder="이름을 입력하세요">
                    </div>
                    <div class="form-group">
                        <label for="phone4">연락처 뒤 4자리</label>
                        <input type="text" id="phone4" name="phone4" required maxlength="4" placeholder="뒤 4자리 입력" inputmode="numeric">
                    </div>
                    <button type="submit">조회하기</button>
                </form>
                <a href="/" class="back-btn" style="display:block; text-align:center; margin-top:20px; text-decoration:none;">메인으로 돌아가기</a>
            </div>
        </body>
        </html>
    `);
});

/**
 * 📌 검색 결과 처리 화면 (POST /entry/search)
 * - 이름과 연락처 뒤 4자리로 선수 조회 (수파베이스 연동)
 * - config.json의 조회 기간 설정을 읽어와 정보 수정 가능 여부를 판단
 */
router.post('/search', async (req, res) => {
    const inputName = (req.body.name || '').trim();
    const inputPhone4 = (req.body.phone4 || '').trim().padStart(4, '0');

    try {
        // 📌 수파베이스 swimmers 테이블에서 데이터 조회
        const { data: dataRows, error: fetchError } = await supabase
            .from('swimmers')
            .select('*');

        if (fetchError) {
            console.error("수파베이스 데이터 조회 오류:", fetchError);
            throw fetchError;
        }

        const rows = dataRows || [];

        // 📌 선수 검색 로직 (이름 및 연락처 뒤 4자리 매칭)
        const foundRow = rows.find(row => {
            const rowName = String(row['name'] || '').trim(); 
            const rawPhone = String(row['phone'] || row['phone4'] || '').trim(); 
            const rowPhone4 = rawPhone.slice(-4).padStart(4, '0');

            return rowName === inputName && rowPhone4 === inputPhone4;
        });

        let resultHtml = '';
        let actionButtonsHtml = '';

        if (foundRow) {
            const regDate = foundRow['registered_at'] || ''; 
            const name = foundRow['name'] || ''; 
            const gender = foundRow['gender'] || ''; 
            const club = foundRow['club'] || ''; 
            const desiredEvent = foundRow['desired_event'] || ''; 
            const expectedTime = foundRow['expected_time'] || ''; 
            // [사유: 운영 정책 변경으로 셔츠(사은품) 조회 항목 일시 숨김 처리]
            // const souvenir1 = foundRow['souvenir1'] || ''; 
            const entryFee = foundRow['entry_fee_status'] || ''; 

            // 📌 config.json에서 조회 기간을 동적으로 확인하여 수정 가능 여부 판단
            let isEditable = false;
            try {
                const config = getConfig();
                const checkStart = config.checkStartDate || config['조회날짜'];
                const checkEnd = config.checkEndDate || config['조회종료날짜'];

                const startDate = checkStart ? new Date(checkStart) : null;
                const endDate = checkEnd ? new Date(checkEnd) : null;
                const now = getKSTDate();
                
                if (startDate && endDate) {
                    isEditable = (now >= startDate && now <= endDate);
                }
            } catch (e) {
                console.error("수정 가능 기간 확인 오류:", e);
            }

            resultHtml = `
                <div class="result-box">
                    <h3>[ 신청 정보 ]</h3>
                    <p><strong>접수일시:</strong> ${regDate}</p>
                    <p><strong>이름:</strong> ${name}</p>
                    <p><strong>성별:</strong> ${gender}</p>
                    <p><strong>소속:</strong> ${club}</p>
                    <p><strong>희망 경기:</strong> ${desiredEvent}</p>
                    <p><strong>예상 기록:</strong> ${expectedTime}</p>
                    <!-- [사유: 셔츠(사은품) 항목을 화면에 표시하지 않기 위해 주석 처리함] -->
                    <!-- <p><strong>셔츠:</strong> ${foundRow['souvenir1'] || ''}</p> -->
                    <p><strong>참가비현황:</strong> ${entryFee}</p>
                    ${!isEditable ? `
                        <p style="margin-top: 15px; color: #dc3545; font-size: 14px; text-align: center;">
                            ※ 접수 정보 수정 기간이 아니므로 조회만 가능합니다.
                        </p>
                    ` : ''}
                </div>
            `;

            actionButtonsHtml = `
                <div style="display: flex; gap: 8px; margin-top: 20px; width: 100%;">
                    <a href="/" style="flex: 1; text-align: center; text-decoration: none; background-color: #6c757d; color: white; height: 48px; line-height: 48px; border-radius: 8px; font-size: 15px; font-weight: bold; box-sizing: border-box;">
                        메인화면
                    </a>
                    <a href="/entry" style="flex: 1; text-align: center; text-decoration: none; background-color: #007bff; color: white; height: 48px; line-height: 48px; border-radius: 8px; font-size: 15px; font-weight: bold; box-sizing: border-box;">
                        다시조회
                    </a>
                    ${isEditable ? `
                        <a href="/entry/edit?name=${encodeURIComponent(name)}&phone4=${encodeURIComponent(inputPhone4)}" style="flex: 1; text-align: center; text-decoration: none; background-color: #ffc107; color: #333; height: 48px; line-height: 48px; border-radius: 8px; font-size: 15px; font-weight: bold; box-sizing: border-box;">
                            ✏️ 정보수정
                        </a>
                    ` : ''}
                </div>
            `;
        } else {
            resultHtml = `
                <div class="error-box">
                    <p>일치하는 신청자 정보를 찾을 수 없습니다.<br>이름과 연락처 뒤 4자리를 다시 확인해주세요.</p>
                </div>
            `;
            
            actionButtonsHtml = `
                <div style="display: flex; gap: 8px; margin-top: 20px; width: 100%;">
                    <a href="/" style="flex: 1; text-align: center; text-decoration: none; background-color: #6c757d; color: white; height: 48px; line-height: 48px; border-radius: 8px; font-size: 15px; font-weight: bold; box-sizing: border-box;">
                        메인화면
                    </a>
                    <a href="/entry" style="flex: 1; text-align: center; text-decoration: none; background-color: #007bff; color: white; height: 48px; line-height: 48px; border-radius: 8px; font-size: 15px; font-weight: bold; box-sizing: border-box;">
                        다시조회
                    </a>
                </div>
            `;
        }

        // 📌 공지사항 파일 읽기
        let noticeText = "등록된 공지사항이 없습니다.";
        try {
            if (fs.existsSync('notice_check.txt')) {
                noticeText = fs.readFileSync('notice_check.txt', 'utf8').replace(/\n/g, '<br>');
            }
        } catch (e) {
            console.error("공지사항 파일을 읽는 중 오류 발생:", e);
        }

        res.send(`
            <!DOCTYPE html>
            <html lang="ko">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>신청자 조회 결과</title>
                <link rel="stylesheet" href="/style.css">
            </head>
            <body>
                <div class="container">
                    <h2>신청자 조회 결과</h2>
                    ${resultHtml}
                    
                    ${actionButtonsHtml}

                    <div class="notice" style="margin-top: 25px;">
                        <h3>[ 공지사항 ]</h3>
                        <p>${noticeText}</p>
                    </div>

                    <div class="images">
                        <h3>[ 안내 이미지 ]</h3>
                        
                        <!-- PC 전용 이미지 -->
                        <img src="/info_100.jpg" alt="안내 이미지 1" class="pc-only" onerror="this.style.display='none'">
                        <img src="/info_200.jpg" alt="안내 이미지 2" class="pc-only" onerror="this.style.display='none'">
                        <img src="/info_300.jpg" alt="안내 이미지 3" class="pc-only" onerror="this.style.display='none'">
                        
                        <!-- 모바일 전용 이미지 -->
                        <img src="/info_101.jpg" alt="안내 이미지 1" class="mobile-only" onerror="this.style.display='none'">
                        <img src="/info_201.jpg" alt="안내 이미지 2" class="mobile-only" onerror="this.style.display='none'">
                        <img src="/info_301.jpg" alt="안내 이미지 3" class="mobile-only" onerror="this.style.display='none'">
                    </div>
                </div>
            </body>
            </html>
        `);

    } catch (error) {
        console.error(error);
        res.send(`
            <div style="margin: 40px; font-family: Arial; text-align: center;">
                <h3>오류가 발생했습니다.</h3>
                <p>수파베이스 연결 상태를 확인해주세요.</p>
                <a href="/entry">돌아가기</a>
            </div>
        `);
    }
});

/**
 * 📌 1. 정보 수정 폼 화면 (GET /entry/edit)
 */
router.get('/edit', async (req, res) => {
    const inputName = (req.query.name || '').trim();
    const inputPhone4 = (req.query.phone4 || '').trim();
    
    const old = req.query.error ? req.query : null;

    try {
        const { data: dataRows, error: fetchError } = await supabase
            .from('swimmers')
            .select('*');

        if (fetchError) throw fetchError;
        const rows = dataRows || [];

        const row = rows.find(r => {
            const rName = String(r['name'] || '').trim();
            const rPhone = String(r['phone'] || '').trim();
            return rName === inputName && rPhone.slice(-4) === inputPhone4;
        });

        if (!row && !old) {
            return res.send(`<script>alert('대상을 찾을 수 없습니다.'); history.back();</script>`);
        }

        // 📌 config.json 파일에서 종목명, 참가비, 제한인원 읽기
        const config = getConfig();
        const configRows = config.events || [];

        // 📌 각 종목별 입금완료' 상태인 인원만 집계
        const paidCounts = {};
        rows.forEach(r => {
            const ev = String(r['desired_event'] || '').trim();
            const status = String(r['entry_fee_status'] || '').trim();
            if (ev && status === '입금완료') {
                paidCounts[ev] = (paidCounts[ev] || 0) + 1;
            }
        });

        const originalEvent = row ? String(row['desired_event'] || '').trim() : '';

        const eventFeeMap = {};
        const eventMaxMap = {};
        configRows.forEach(cr => {
            const evName = String(cr['eventName'] || '').trim();
            if (evName) {
                eventFeeMap[evName] = Number(cr['entryFee'] || 0);
                eventMaxMap[evName] = Number(cr['maxParticipants'] || 0);
            }
        });

        const currentEventFee = eventFeeMap[originalEvent] || 0;

        const getVal = (formField, excelField) => {
            if (old && old[formField] !== undefined) return old[formField];
            return row ? (row[excelField] || '') : '';
        };

        const nameVal = getVal('originName', 'name');
        const phoneVal = String(getVal('phone', 'phone')).replace(/[^0-9]/g, '');
        const phone4Val = phoneVal.slice(-4);
        const addressVal = getVal('address', 'address');
        
        const clubText = getVal('club', 'club');
        const hasClubVal = old ? old.hasClub : (clubText && clubText !== '없음' ? 'yes' : 'no');
        const clubInputVal = hasClubVal === 'yes' ? (clubText === '없음' ? '' : clubText) : '';

        const desiredEventVal = getVal('desiredEvent', 'desired_event') || originalEvent;
        const expectedTimeVal = String(getVal('expectedTime', 'expected_time')).replace(/[^0-9]/g, '');
        const guardianNameVal = getVal('guardianName', 'guardian_name');
        const guardianPhoneVal = String(getVal('guardianPhone', 'guardian_phone')).replace(/[^0-9]/g, '');
        
        const medicalText = getVal('memo', 'medical_memo');
        const hasMedicalVal = old ? old.hasMedical : (medicalText && medicalText !== '없음' ? 'yes' : 'no');
        const memoInputVal = hasMedicalVal === 'yes' ? (medicalText === '없음' ? '' : medicalText) : '';

        // [사유: 운영 정책 변경으로 셔츠(사은품) 수정 값 불러오기 일시 숨김 처리]
        // const souvenirVal = getVal('souvenir1', 'souvenir1');
        const marketingVal = getVal('marketingConsent', 'marketing_consent');

        const checkMatch = (val, target) => {
            const v = String(val || '').trim();
            const t = String(target || '').trim();
            return v === t || v.includes(t) || t.includes(v);
        };

        // 📌 동적 종목 라디오 버튼 생성 및 참가비/입금완료 제한인원 검증 로직 반영
        let eventRadiosHtml = '';
        configRows.forEach(cr => {
            const evName = String(cr['eventName'] || '').trim();
            if (!evName) return;
            const evFee = Number(cr['entryFee'] || 0);
            const evMax = Number(cr['maxParticipants'] || 0);

            let currentPaid = 0;
            for (const [ev, count] of Object.entries(paidCounts)) {
                if (ev === evName || ev.includes(evName) || evName.includes(ev)) {
                    currentPaid += count;
                }
            }

            const isOwnEvent = checkMatch(originalEvent, evName);
            const isSameFee = (evFee === currentEventFee);
            const isFull = !isOwnEvent && (evMax > 0 && currentPaid >= evMax);
            const selectable = isOwnEvent || (isSameFee && !isFull);

            const isChecked = checkMatch(desiredEventVal, evName) ? 'checked' : '';

            let badge = '';
            if (!isSameFee) {
                badge = ' (관리자에게 문의 바랍니다)';
            } else if (isFull) {
                badge = ' (관리자에게 문의 바랍니다)';
            }

            eventRadiosHtml += `
                <div style="margin-bottom: 8px;" onclick="onEventOptionClick('${evName}', ${isSameFee}, ${isFull}, ${isOwnEvent})">
                    <label class="radio-label" style="${!selectable ? 'opacity: 0.6; color: #888; cursor: not-allowed;' : 'cursor: pointer;'}">
                        <input type="radio" name="desiredEvent" value="${evName}" ${isChecked} ${!selectable ? 'disabled' : ''}> 
                        ${evName}${badge}
                    </label>
                </div>
            `;
        });

        res.send(`
            <!DOCTYPE html>
            <html lang="ko">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>참가자 정보 수정</title>
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

                    function onEventOptionClick(evName, isSameFee, isFull, isOwnEvent) {
                        if (isOwnEvent) return;
                        if (!isSameFee) {
                            alert('관리자의 확인이 필요합니다.');
                        } else if (isFull) {
                            alert('관리자의 확인이 필요합니다.');
                        }
                    }

                    window.onload = function() {
                        const hasClubChecked = document.querySelector('input[name="hasClub"]:checked');
                        if (hasClubChecked) toggleClubInput(hasClubChecked.value);

                        const hasMedicalChecked = document.querySelector('input[name="hasMedical"]:checked');
                        if (hasMedicalChecked) toggleMedicalInput(hasMedicalChecked.value);
                    };
                </script>
            </head>
            <body>
                <div class="container">
                    <h2>참가자 정보 수정</h2>
                    <form action="/entry/update" method="POST">
                        <input type="hidden" name="originName" value="${nameVal}">
                        <input type="hidden" name="originPhone4" value="${phone4Val}">

                        <div class="form-group">
                            <label>이름 (수정 불가)</label>
                            <input type="text" value="${nameVal}" disabled>
                        </div>

                        <div class="form-group">
                            <label for="phone">연락처 <br>(숫자만 입력)</label>
                            <input type="text" id="phone" name="phone" required maxlength="12" placeholder="예: 01012341234" value="${phoneVal}" inputmode="numeric" oninput="this.value=this.value.replace(/[^0-9]/g,'')">
                        </div>

                        <div class="form-group">
                            <label for="address">주소 (선택 입력)</label>
                            <input type="text" id="address" name="address" placeholder="생략 가능" value="${addressVal}">
                        </div>

                        <div class="form-group">
                            <label>소속클럽 여부</label>
                            <div class="radio-group">
                                <label class="radio-label"><input type="radio" name="hasClub" value="no" ${hasClubVal === 'no' ? 'checked' : ''} onclick="toggleClubInput('no')"> 없음</label>
                                <label class="radio-label"><input type="radio" name="hasClub" value="yes" ${hasClubVal === 'yes' ? 'checked' : ''} onclick="toggleClubInput('yes')"> 있음</label>
                            </div>
                        </div>

                        <div class="form-group">
                            <label for="club">소속클럽명</label>
                            <input type="text" id="club" name="club" placeholder="클럽이 있는경우 입력" value="${clubInputVal}" disabled>
                        </div>

                        <div class="form-group">
                            <label>희망종목</label>
                            <div class="radio-group">
                                ${eventRadiosHtml}
                            </div>
                        </div>

                        <div class="form-group">
                            <label for="expectedTime">예상기록 <br>(예:1:10:30 = 11030)</label>
                            <input type="text" id="expectedTime" name="expectedTime" required maxlength="5" placeholder="5자리 입력 (예: 11030)" value="${expectedTimeVal}" inputmode="numeric" oninput="this.value=this.value.replace(/[^0-9]/g,'')">
                        </div>

                        <div class="form-group">
                            <label for="guardianName">보호자 이름</label>
                            <input type="text" id="guardianName" name="guardianName" required placeholder="(띄어쓰기 없이)" value="${guardianNameVal}" oninput="this.value=this.value.replace(/\\s/g,'')">
                        </div>

                        <div class="form-group">
                            <label for="guardianPhone">보호자 연락처 <br>(숫자 입력)</label>
                            <input type="text" id="guardianPhone" name="guardianPhone" required maxlength="12" placeholder="예: 01012341234" value="${guardianPhoneVal}" inputmode="numeric" oninput="this.value=this.value.replace(/[^0-9]/g,'')">
                        </div>

                        <div class="form-group">
                            <label>질병유무</label>
                            <div class="radio-group">
                                <label class="radio-label"><input type="radio" name="hasMedical" value="no" ${hasMedicalVal === 'no' ? 'checked' : ''} onclick="toggleMedicalInput('no')"> 없음</label>
                                <label class="radio-label"><input type="radio" name="hasMedical" value="yes" ${hasMedicalVal === 'yes' ? 'checked' : ''} onclick="toggleMedicalInput('yes')"> 있음</label>
                            </div>
                        </div>

                        <div class="form-group">
                            <label for="memo">기타 사항 (질병 유무가 있는 경우 작성)</label>
                            <textarea id="memo" name="memo" placeholder="상세 내용을 적어주세요" disabled>${memoInputVal}</textarea>
                        </div>

                        <!-- ==========================================
                          [기능 임시 중단] 추후 재사용을 위해 코드를 유지함.
                          사유: 운영 정책 변경으로 인해 셔츠(사은품) 선택 항목을 일시 숨김 처리함.
                          ========================================== -->
                        <!-- 
                        <div class="form-group">
                            <label>기념품 (셔츠 사이즈)</label>
                            <div class="radio-group">
                                <label class="radio-label"><input type="radio" name="souvenir1" value="S (85 ~ 90)" ${checkMatch('', 'S (85 ~ 90)') ? 'checked' : ''}> S (85 ~ 90)</label>
                                <label class="radio-label"><input type="radio" name="souvenir1" value="M (95 ~ 100)" ${checkMatch('', 'M (95 ~ 100)') ? 'checked' : ''}> M (95 ~ 100)</label>
                                <label class="radio-label"><input type="radio" name="souvenir1" value="L (100 ~ 105)" ${checkMatch('', 'L (100 ~ 105)') ? 'checked' : ''}> L (100 ~ 105)</label>
                                <label class="radio-label"><input type="radio" name="souvenir1" value="XL (105 ~ 110)" ${checkMatch('', 'XL (105 ~ 110)') ? 'checked' : ''}> XL (105 ~ 110)</label>
                                <label class="radio-label"><input type="radio" name="souvenir1" value="XXL (110 ~ 115)" ${checkMatch('', 'XXL (110 ~ 115)') ? 'checked' : ''}> XXL (110 ~ 115)</label>
                            </div>
                        </div>
                        -->

                        <div class="form-group">
                            <label>홍보동의여부</label>
                            <div class="radio-group">
                                <label class="radio-label"><input type="radio" name="marketingConsent" value="받고 싶다" ${checkMatch(marketingVal, '받고 싶다') ? 'checked' : ''} required> 받고 싶다</label>
                                <label class="radio-label"><input type="radio" name="marketingConsent" value="받고 싶지 않다" ${checkMatch(marketingVal, '받고 싶지 않다') ? 'checked' : ''}> 받고 싶지 않다</label>
                            </div>
                        </div>

                        <button type="submit" style="background-color: #28a745;">수정 완료</button>
                    </form>
                    <a href="javascript:history.back();" style="display:block; text-align:center; margin-top:20px; text-decoration:none; background-color:#6c757d; color:white; height:50px; line-height:50px; border-radius:8px; font-weight:bold;">취소</a>
                </div>
            </body>
            </html>
        `);
    } catch (e) {
        console.error(e);
        res.send(`<script>alert('오류가 발생했습니다.'); window.location.href='/entry';</script>`);
    }
});

/**
 * 📌 2. 정보 수정 반영 처리 (POST /entry/update)
 * - 수정 데이터를 입력받아 수파베이스 swimmers 테이블에 반영
 * - 수정 시점의 한국 표준시(KST)를 'updated_at_custom' 컬럼에 기록
 */
router.post('/update', async (req, res) => {
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

    const originName = req.body.originName;
    const originPhone4 = req.body.originPhone4;

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
    // [사유: 셔츠(사은품) 항목 비활성화로 인한 데이터 추출 임시 중단]
    // const souvenir1 = req.body.souvenir1 || '';
    const marketingConsent = req.body.marketingConsent || '';

    const phone = formatPhone(rawPhone);
    const guardianPhone = formatPhone(rawGuardianPhone);
    const phone4 = rawPhone.slice(-4);
    const expectedTime = formatTime(rawExpectedTime);

    const qs = `?name=${encodeURIComponent(originName)}&phone4=${encodeURIComponent(originPhone4)}&error=true&` + getQueryString(req.body);

    // 📌 유효성 검사
    if (!rawPhone) return res.send(`<script>alert('연락처를 입력해 주세요.'); window.location.href='/entry/edit${qs}';</script>`);
    if (hasClub === 'yes' && !club) return res.send(`<script>alert('소속클럽명을 입력해 주세요.'); window.location.href='/entry/edit${qs}';</script>`);
    if (!desiredEvent) return res.send(`<script>alert('희망종목를 선택해 주세요.'); window.location.href='/entry/edit${qs}';</script>`);
    if (!rawExpectedTime) return res.send(`<script>alert('예상기록을 입력해 주세요.'); window.location.href='/entry/edit${qs}';</script>`);
    if (!guardianName) return res.send(`<script>alert('보호자 이름을 입력해 주세요.'); window.location.href='/entry/edit${qs}';</script>`);
    if (!rawGuardianPhone) return res.send(`<script>alert('보호자 연락처를 입력해 주세요.'); window.location.href='/entry/edit${qs}';</script>`);
    if (hasMedical === 'yes' && !memo) return res.send(`<script>alert('질병 내용을 입력해 주세요.'); window.location.href='/entry/edit${qs}';</script>`);
    // [사유: 셔츠(사은품) 항목 비활성화로 인한 필수 입력 유효성 검사 임시 중단]
    // if (!souvenir1) return res.send(`<script>alert('기념품(셔츠 사이즈)을 선택해 주세요.'); window.location.href='/entry/edit${qs}';</script>`);
    if (!marketingConsent) return res.send(`<script>alert('홍보동의여부를 선택해 주세요.'); window.location.href='/entry/edit${qs}';</script>`);

    if (rawPhone.length < 8 || rawPhone.length > 12) {
        return res.send(`<script>alert('연락처는 숫자 8~12자리여야 합니다.'); window.location.href='/entry/edit${qs}';</script>`);
    }
    if (rawGuardianPhone.length < 8 || rawGuardianPhone.length > 12) {
        return res.send(`<script>alert('보호자 연락처는 숫자 8~12자리여야 합니다.'); window.location.href='/entry/edit${qs}';</script>`);
    }
    if (rawExpectedTime.length !== 5) {
        return res.send(`<script>alert('예상기록은 HMMSS 형식의 숫자 5자리여야 합니다.'); window.location.href='/entry/edit${qs}';</script>`);
    }

    try {
        const { data: dataRows, error: fetchError } = await supabase
            .from('swimmers')
            .select('*');

        if (fetchError) throw fetchError;
        const rows = dataRows || [];

        const targetRow = rows.find(row => {
            const rName = String(row['name'] || '').trim();
            const rPhone = String(row['phone'] || '').trim();
            const rPhone4 = rPhone.slice(-4).padStart(4, '0');
            return rName === originName && rPhone4 === originPhone4;
        });

        if (!targetRow) {
            return res.send(`<script>alert('수정할 대상을 찾을 수 없습니다.'); window.location.href='/entry';</script>`);
        }

        const originalEvent = String(targetRow['desired_event'] || '').trim();

        // 📌 config.json 파일에서 참가비 및 제한인원 확인
        const config = getConfig();
        const configRows = config.events || [];
        const eventFeeMap = {};
        const eventMaxMap = {};
        configRows.forEach(cr => {
            const evName = String(cr['eventName'] || '').trim();
            if (evName) {
                eventFeeMap[evName] = Number(cr['entryFee'] || 0);
                eventMaxMap[evName] = Number(cr['maxParticipants'] || 0);
            }
        });

        const originalFee = eventFeeMap[originalEvent] || 0;
        const newFee = eventFeeMap[desiredEvent] || 0;

        // 📌 참가비 검증 (다른 참가비 종목으로 변경 시 차단)
        if (desiredEvent !== originalEvent && newFee !== originalFee) {
            return res.send(`<script>alert('참가비가 달라서 관리자의 확인이 필요합니다.'); window.location.href='/entry/edit${qs}';</script>`);
        }

        // 📌 제한인원 검증 (참가비현황이 '입금완료'인 인원 기준)
        if (desiredEvent !== originalEvent) {
            const maxPart = eventMaxMap[desiredEvent] || 0;
            const paidCount = rows.filter(r => {
                const ev = String(r['desired_event'] || '').trim();
                const status = String(r['entry_fee_status'] || '').trim();
                return ev === desiredEvent && status === '입금완료';
            }).length;

            if (maxPart > 0 && paidCount >= maxPart) {
                return res.send(`<script>alert('관리자의 확인이 필요합니다.'); window.location.href='/entry/edit${qs}';</script>`);
            }
        }

        // 📌 한국 표준시(KST) 기준 수정 날짜 문자열 생성
        const now = getKSTDate();
        const updateDateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;

        // 📌 수파베이스 swimmers 테이블 업데이트 실행
        const { error: updateError } = await supabase
            .from('swimmers')
            .update({
                phone: phone,
                phone4: phone4,
                address: address,
                club: club,
                desired_event: desiredEvent,
                expected_time: expectedTime,
                guardian_name: guardianName,
                guardian_phone: guardianPhone,
                medical_memo: memo,
                // [사유: 셔츠(사은품) 항목 비활성화로 인한 업데이트 데이터 반영 임시 중단]
                // souvenir1: souvenir1,
                marketing_consent: marketingConsent,
                updated_at_custom: updateDateStr,
                updated_by: '선수'
            })
            .eq('id', targetRow.id);

        if (updateError) {
            console.error("수파베이스 업데이트 오류:", updateError);
            throw updateError;
        }

        res.send(`
            <form id="searchRedirect" action="/entry/search" method="POST">
                <input type="hidden" name="name" value="${originName}">
                <input type="hidden" name="phone4" value="${phone4}">
            </form>
            <script>
                alert('정보가 성공적으로 수정되었습니다.');
                document.getElementById('searchRedirect').submit();
            </script>
        `);

    } catch (error) {
        console.error("선수 정보 수정 반영 오류:", error);
        res.send(`<script>alert('수정 처리 중 오류가 발생했습니다.'); window.location.href='/entry';</script>`);
    }
});

module.exports = router;