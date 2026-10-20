const express = require('express');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const router = express.Router();

// 메인 입력 화면 (GET /) -> 조회 폼
router.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="ko">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>신청자 명단 조회</title>
            <link rel="stylesheet" href="/style.css">
        </head>
        <body>
            <div class="container">
                <h2>신청자 명단 조회</h2>
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

// 검색 결과 처리 화면 (POST /search)
router.post('/search', (req, res) => {
    const inputName = (req.body.name || '').trim();
    const inputPhone4 = (req.body.phone4 || '').trim().padStart(4, '0');

    try {
        const workbook = xlsx.readFile('swimmers.xlsx'); 
        const sheetName = '선수명단';
        const sheet = workbook.Sheets[sheetName];
        
        const dataRows = sheet ? xlsx.utils.sheet_to_json(sheet) : [];

        const foundRow = dataRows.find(row => {
            const rowName = String(row['이름'] || '').trim(); 
            const rawPhone = String(row['연락처'] || row['연락처4'] || '').trim(); 
            const rowPhone4 = rawPhone.slice(-4).padStart(4, '0');

            return rowName === inputName && rowPhone4 === inputPhone4;
        });

        let resultHtml = '';
        let actionButtonsHtml = '';

        if (foundRow) {
            const regDate = foundRow['접수날짜'] || ''; 
            const name = foundRow['이름'] || ''; 
            const gender = foundRow['성별'] || ''; 
            const club = foundRow['소속클럽'] || ''; 
            const desiredEvent = foundRow['희망종목'] || ''; 
            const expectedTime = foundRow['예상기록'] || ''; 
            const souvenir1 = foundRow['기념품1'] || ''; 
            const entryFee = foundRow['참가비현황'] || ''; 

            const startDate = new Date('2026-10-01T00:00:00');
            const endDate = new Date('2026-10-31T23:59:59');
            const now = new Date();
            const isEditable = now >= startDate && now <= endDate;

            resultHtml = `
                <div class="result-box">
                    <h3>[ 신청 정보 ]</h3>
                    <p><strong>접수일시:</strong> ${regDate}</p>
                    <p><strong>이름:</strong> ${name}</p>
                    <p><strong>성별:</strong> ${gender}</p>
                    <p><strong>소속:</strong> ${club}</p>
                    <p><strong>희망 경기:</strong> ${desiredEvent}</p>
                    <p><strong>예상 기록:</strong> ${expectedTime}</p>
                    <p><strong>셔츠:</strong> ${souvenir1}</p>
                    <p><strong>참가비현황:</strong> ${entryFee}</p>
                    ${!isEditable ? `
                        <p style="margin-top: 15px; color: #dc3545; font-size: 14px; text-align: center;">
                            ※ 접수 기간이 마감되어 정보 수정이 불가합니다. (조회 전용)
                        </p>
                    ` : ''}
                </div>
            `;

            // 📌 버튼 3개 배치 (메인화면 -> 다시조회 -> 정보수정)
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
            
            // 검색 결과 실패 시 메인화면, 다시조회 버튼만 나란히 표시
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
                    <h2>신청자 명단 조회 결과 check</h2>
                    ${resultHtml}
                    
                    ${actionButtonsHtml}

                    <div class="notice" style="margin-top: 25px;">
                        <h3>[ 공지사항 ]</h3>
                        <p>${noticeText}</p>
                    </div>

                    <div class="images">
                        <h3>[ 안내 이미지 ]</h3>
                        <img src="/info_01.jpg" alt="안내 이미지 1" onerror="this.style.display='none'">
                        <img src="/info_02.jpg" alt="안내 이미지 2" onerror="this.style.display='none'">
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
                <p>엑셀 파일 이름(swimmers.xlsx)이 올바른지 확인해주세요.</p>
                <a href="/entry">돌아가기</a>
            </div>
        `);
    }
});

// 📌 1. 정보 수정 폼 화면 (GET /entry/edit)
router.get('/edit', (req, res) => {
    const inputName = (req.query.name || '').trim();
    const inputPhone4 = (req.query.phone4 || '').trim();
    
    const old = req.query.error ? req.query : null;

    try {
        const workbook = xlsx.readFile('swimmers.xlsx');
        const sheet = workbook.Sheets['선수명단'];
        const dataRows = sheet ? xlsx.utils.sheet_to_json(sheet) : [];

        const row = dataRows.find(r => {
            const rName = String(r['이름'] || '').trim();
            const rPhone = String(r['연락처'] || '').trim();
            return rName === inputName && rPhone.slice(-4) === inputPhone4;
        });

        if (!row && !old) {
            return res.send(`<script>alert('대상을 찾을 수 없습니다.'); history.back();</script>`);
        }

        const getVal = (formField, excelField) => {
            if (old && old[formField] !== undefined) return old[formField];
            return row ? (row[excelField] || '') : '';
        };

        const nameVal = getVal('originName', '이름');
        const phoneVal = String(getVal('phone', '연락처')).replace(/[^0-9]/g, '');
        const phone4Val = phoneVal.slice(-4);
        const addressVal = getVal('address', '주소');
        
        const clubText = getVal('club', '소속클럽');
        const hasClubVal = old ? old.hasClub : (clubText && clubText !== '없음' ? 'yes' : 'no');
        const clubInputVal = hasClubVal === 'yes' ? (clubText === '없음' ? '' : clubText) : '';

        const desiredEventVal = getVal('desiredEvent', '희망종목');
        const expectedTimeVal = String(getVal('expectedTime', '예상기록')).replace(/[^0-9]/g, '');
        const guardianNameVal = getVal('guardianName', '보호자이름');
        const guardianPhoneVal = String(getVal('guardianPhone', '보호자연락처')).replace(/[^0-9]/g, '');
        
        const medicalText = getVal('memo', '질병유무');
        const hasMedicalVal = old ? old.hasMedical : (medicalText && medicalText !== '없음' ? 'yes' : 'no');
        const memoInputVal = hasMedicalVal === 'yes' ? (medicalText === '없음' ? '' : medicalText) : '';

        const souvenirVal = getVal('souvenir1', '기념품1');
        const marketingVal = getVal('marketingConsent', '홍보동의여부');

        res.send(`
            <!DOCTYPE html>
            <html lang="ko">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>참가 신청 정보 수정</title>
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
                        const hasClubChecked = document.querySelector('input[name="hasClub"]:checked');
                        if (hasClubChecked) toggleClubInput(hasClubChecked.value);

                        const hasMedicalChecked = document.querySelector('input[name="hasMedical"]:checked');
                        if (hasMedicalChecked) toggleMedicalInput(hasMedicalChecked.value);
                    };
                </script>
            </head>
            <body>
                <div class="container">
                    <h2>참가 신청 정보 수정</h2>
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
                                <label class="radio-label"><input type="radio" name="desiredEvent" value="1부 5Km (07시 시작)" ${desiredEventVal === '1부 5Km (07시 시작)' ? 'checked' : ''} required> 1부 5Km (07시)</label>
                                <label class="radio-label"><input type="radio" name="desiredEvent" value="2부 5Km (09시 시작)" ${desiredEventVal === '2부 5Km (09시 시작)' ? 'checked' : ''}> 2부 5Km (09시)</label>
                                <label class="radio-label"><input type="radio" name="desiredEvent" value="3부 10km (11시 10분 시작)" ${desiredEventVal === '3부 10km (11시 10분 시작)' ? 'checked' : ''}> 3부 10km (11시 10분)</label>
                                <label class="radio-label"><input type="radio" name="desiredEvent" value="4부 5Km (15시 30분 시작)" ${desiredEventVal === '4부 5Km (15시 30분 시작)' ? 'checked' : ''}> 4부 5Km (15시 30분)</label>
                            </div>
                        </div>

                        <div class="form-group">
                            <label for="expectedTime">예상기록 <br>(예:11030 = 1:10:30)</label>
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

                        <div class="form-group">
                            <label>기념품 (셔츠 사이즈)</label>
                            <div class="radio-group">
                                <label class="radio-label"><input type="radio" name="souvenir1" value="S (85 ~ 90)" ${souvenirVal === 'S (85 ~ 90)' ? 'checked' : ''} required> S (85 ~ 90)</label>
                                <label class="radio-label"><input type="radio" name="souvenir1" value="M (95 ~ 100)" ${souvenirVal === 'M (95 ~ 100)' ? 'checked' : ''}> M (95 ~ 100)</label>
                                <label class="radio-label"><input type="radio" name="souvenir1" value="L (100 ~ 105)" ${souvenirVal === 'L (100 ~ 105)' ? 'checked' : ''}> L (100 ~ 105)</label>
                                <label class="radio-label"><input type="radio" name="souvenir1" value="XL (105 ~ 110)" ${souvenirVal === 'XL (105 ~ 110)' ? 'checked' : ''}> XL (105 ~ 110)</label>
                                <label class="radio-label"><input type="radio" name="souvenir1" value="XXL (110 ~ 115)" ${souvenirVal === 'XXL (110 ~ 115)' ? 'checked' : ''}> XXL (110 ~ 115)</label>
                            </div>
                        </div>

                        <div class="form-group">
                            <label>홍보동의여부</label>
                            <div class="radio-group">
                                <label class="radio-label"><input type="radio" name="marketingConsent" value="알림을 원함" ${marketingVal === '알림을 원함' ? 'checked' : ''} required> 알림 원함</label>
                                <label class="radio-label"><input type="radio" name="marketingConsent" value="알림을 원치 않음" ${marketingVal === '알림을 원치 않음' ? 'checked' : ''}> 알림 원치 않음</label>
                            </div>
                        </div>

                        <button type="submit" style="background-color: #28a745;">수정 완료</button>
                    </form>
                    <a href="/entry" style="display:block; text-align:center; margin-top:20px; text-decoration:none; background-color:#6c757d; color:white; height:50px; line-height:50px; border-radius:8px; font-weight:bold;">취소</a>
                </div>
            </body>
            </html>
        `);
    } catch (e) {
        console.error(e);
        res.send(`<script>alert('오류가 발생했습니다.'); window.location.href='/entry';</script>`);
    }
});

// 📌 2. 정보 수정 반영 처리 (POST /entry/update)
router.post('/update', (req, res) => {
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
    const souvenir1 = req.body.souvenir1 || '';
    const marketingConsent = req.body.marketingConsent || '';

    const phone = formatPhone(rawPhone);
    const guardianPhone = formatPhone(rawGuardianPhone);
    const phone4 = rawPhone.slice(-4);
    const expectedTime = formatTime(rawExpectedTime);

    const qs = `?name=${encodeURIComponent(originName)}&phone4=${encodeURIComponent(originPhone4)}&error=true&` + getQueryString(req.body);

    if (!rawPhone) return res.send(`<script>alert('연락처를 입력해 주세요.'); window.location.href='/entry/edit${qs}';</script>`);
    if (hasClub === 'yes' && !club) return res.send(`<script>alert('소속클럽명을 입력해 주세요.'); window.location.href='/entry/edit${qs}';</script>`);
    if (!desiredEvent) return res.send(`<script>alert(희망종목를 선택해 주세요.'); window.location.href='/entry/edit${qs}';</script>`);
    if (!rawExpectedTime) return res.send(`<script>alert('예상기록을 입력해 주세요.'); window.location.href='/entry/edit${qs}';</script>`);
    if (!guardianName) return res.send(`<script>alert('보호자 이름을 입력해 주세요.'); window.location.href='/entry/edit${qs}';</script>`);
    if (!rawGuardianPhone) return res.send(`<script>alert('보호자 연락처를 입력해 주세요.'); window.location.href='/entry/edit${qs}';</script>`);
    if (hasMedical === 'yes' && !memo) return res.send(`<script>alert('질병 내용을 입력해 주세요.'); window.location.href='/entry/edit${qs}';</script>`);
    if (!souvenir1) return res.send(`<script>alert('기념품(셔츠 사이즈)을 선택해 주세요.'); window.location.href='/entry/edit${qs}';</script>`);
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
        const filePath = 'swimmers.xlsx';
        const workbook = xlsx.readFile(filePath);
        const sheetName = '선수명단';
        const sheet = workbook.Sheets[sheetName];
        let dataRows = xlsx.utils.sheet_to_json(sheet);

        const index = dataRows.findIndex(row => {
            const rName = String(row['이름'] || '').trim();
            const rPhone = String(row['연락처'] || '').trim();
            const rPhone4 = rPhone.slice(-4).padStart(4, '0');
            return rName === originName && rPhone4 === originPhone4;
        });

        if (index !== -1) {
            const now = new Date();
            const updateDateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;

            dataRows[index]['연락처'] = phone;
            dataRows[index]['연락처4'] = phone4;
            dataRows[index]['주소'] = address;
            dataRows[index]['소속클럽'] = club;
            dataRows[index]['희망종목'] = desiredEvent;
            dataRows[index]['예상기록'] = expectedTime;
            dataRows[index]['보호자이름'] = guardianName;
            dataRows[index]['보호자연락처'] = guardianPhone;
            dataRows[index]['질병유무'] = memo;
            dataRows[index]['기념품1'] = souvenir1;
            dataRows[index]['홍보동의여부'] = marketingConsent;

            dataRows[index]['수정날짜'] = updateDateStr;
            dataRows[index]['수정자'] = '선수';

            const newSheet = xlsx.utils.json_to_sheet(dataRows);
            workbook.Sheets[sheetName] = newSheet;
            xlsx.writeFile(workbook, filePath);

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
        } else {
            res.send(`<script>alert('수정 대상을 찾지 못했습니다.'); window.location.href='/entry';</script>`);
        }
    } catch (error) {
        console.error(error);
        res.send(`<script>alert('수정 중 오류가 발생했습니다.'); window.location.href='/entry/edit${qs}';</script>`);
    }
});

module.exports = router;