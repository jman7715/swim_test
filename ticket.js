const { getKSTDate, validateRRN } = require('./utils'); 
const express = require('express');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const router = express.Router();


// ------------------------------------------------------------------
// 🛡️ [동시접속 데이터 유실 방지] 대기열(Queue) 및 순차 처리 로직
// ------------------------------------------------------------------
const registerQueue = []; // 접수 요청을 순서대로 저장할 대기열 배열
let isProcessingQueue = false; // 현재 엑셀 파일 저장 작업 중인지 나타내는 플래그

/**
 * 📌 대기열에 쌓인 접수건을 하나씩 꺼내어 순차적으로 엑셀에 저장하는 함수
 */
async function processRegisterQueue() {
    // 이미 다른 작업을 처리 중이거나 대기열이 비어있으면 종료
    if (isProcessingQueue || registerQueue.length === 0) {
        return;
    }

    isProcessingQueue = true; // 작업 시작 플래그 잠금
    const task = registerQueue.shift(); // 대기열의 맨 앞에 있는 작업 꺼내기

    const { newRow, idNumber, name, qs, res } = task;

    try {
        const filePath = 'swimmers.xlsx';
        let workbook;
        let sheet;
        const sheetName = '선수명단';

        // 📌 기존 엑셀 파일 로드 또는 생성
        if (fs.existsSync(filePath)) {
            workbook = xlsx.readFile(filePath);
            sheet = workbook.Sheets[sheetName];
        }

        let dataRows = [];
        if (sheet) {
            dataRows = xlsx.utils.sheet_to_json(sheet);
        } else {
            workbook = xlsx.utils.book_new();
            sheet = xlsx.utils.json_to_sheet([]);
            xlsx.utils.book_append_sheet(workbook, sheet, sheetName);
        }

        // 📌 중복 접수 체크 (이름과 주민등록번호 동시 일치 여부 확인)
        const isAlreadyRegistered = dataRows.some(row => {
            return String(row['이름'] || '').trim() === name && String(row['주민등록번호'] || '').trim() === idNumber;
        });

        if (isAlreadyRegistered) {
            res.send(`<script>alert('이미 접수된 사용자입니다. (이름과 주민등록번호가 일치합니다.)'); window.location.href='/register${qs}';</script>`);
        } else {
            // 📌 안전하게 신규 데이터 추가 및 엑셀 저장
            dataRows.push(newRow);
            const newSheet = xlsx.utils.json_to_sheet(dataRows);
            workbook.Sheets[sheetName] = newSheet;
            xlsx.writeFile(workbook, filePath);

            res.send(`<script>alert('접수가 완료되었습니다!'); window.location.href = '/';</script>`);
        }
    } catch (error) {
        console.error("엑셀 저장 중 오류 발생:", error);
        res.send(`
            <script>
                alert('접수 처리 중 일시적인 오류가 발생했습니다. 다시 시도해 주세요.');
                window.location.href = '/register${qs}';
            </script>
        `);
    } finally {
        isProcessingQueue = false; // 작업 완료 후 플래그 해제
        // 대기열에 남은 작업이 있다면 다음 작업 연속 실행
        if (registerQueue.length > 0) {
            setImmediate(processRegisterQueue);
        }
    }
}

/**
 * 📌 메인 입력 화면 (GET /register)
 * - 참가 접수 폼 페이지를 출력합니다.
 * - 입력 검증 실패 시 기존 입력했던 데이터(req.query)를 복원하여 유저 편의성을 제공합니다.
 */
router.get('/', (req, res) => {
    // 📌 에러 발생 등으로 재진입 시 기존 입력 데이터 복원용 객체
    const old = req.query || {};

    res.send(`
        <!DOCTYPE html>
        <html lang="ko">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>2026 아쿠아 마라톤 참가 접수</title>
            <link rel="stylesheet" href="/style.css">
            <style>
                /* 포커스 시 연한 노란색 배경 및 placeholder 제어 */
                input:focus, textarea:focus {
                    background-color: #ffffe0 !important;
                    outline: 2px solid #ffc107;
                }
                input::placeholder, textarea::placeholder {
                    color: #999;
                    transition: color 0.2s;
                }
                input:focus::placeholder, textarea:focus::placeholder {
                    color: transparent; /* 포커스 시 예시 문구 숨김 */
                }
            </style>
            <script>
                // 📌 소속클럽 유무 라디오 버튼 클릭 시 입력란 활성화/비활성화 처리
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

                // 📌 질병 유무 라디오 버튼 클릭 시 메모란 활성화/비활성화 처리
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

                // 📌 페이지 로드 시 기존 선택값에 맞춰 입력란 상태 초기화
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
                        <label for="idNumber">3. 주민등록번호 <br> (숫자 13자리 입력)</label>
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

                    <!-- 7. 희망종목 선택 -->
                    <div class="form-group">
                        <label>7. 희망종목</label>
                        <div class="radio-group">
                            <label class="radio-label"><input type="radio" name="desiredEvent" value="1부 5Km (07시)" ${old.desiredEvent === '1부 5Km (07시)' ? 'checked' : ''} required> 1부 5Km (07시)</label>
                            <label class="radio-label"><input type="radio" name="desiredEvent" value="2부 5Km (09시)" ${old.desiredEvent === '2부 5Km (09시)' ? 'checked' : ''}> 2부 5Km (09시)</label>
                            <label class="radio-label"><input type="radio" name="desiredEvent" value="3부 10km (11시 10분)" ${old.desiredEvent === '3부 10km (11시 10분)' ? 'checked' : ''}> 3부 10km (11시 10분)</label>
                            <label class="radio-label"><input type="radio" name="desiredEvent" value="4부 5Km (15시 30분)" ${old.desiredEvent === '4부 5Km (15시 30분)' ? 'checked' : ''}> 4부 5Km (15시 30분)</label>
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
 * - 입력값 검증 후 대기열(Queue)에 요청을 추가하고 순차 처리를 실행합니다.
 */
router.post('/search', (req, res) => {
    // 📌 에러 발생 시 입력 폼으로 이전 데이터 전달용 쿼리스트링 생성 함수
    const getQueryString = (body) => {
        return Object.keys(body)
            .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(body[key] || ''))
            .join('&');
    };

    // 📌 전화번호 하이픈(-) 포맷팅 헬퍼 함수
    const formatPhone = (num) => {
        const cleaned = (num || '').replace(/[^0-9]/g, '');
        if (cleaned.length === 11) return cleaned.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3');
        if (cleaned.length === 10) return cleaned.startsWith('02') ? cleaned.replace(/(\d{2})(\d{4})(\d{4})/, '$1-$2-$3') : cleaned.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
        if (cleaned.length === 8) return cleaned.replace(/(\d{4})(\d{4})/, '$1-$2');
        return cleaned;
    };

    // 📌 예상기록 HMMSS -> H:MM:SS 포맷팅 헬퍼 함수
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

    // 📌 POST 폼 데이터 가져오기 및 공백 제거
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

    // 📌 데이터 가공 (하이픈 추가 및 자릿수 추출)
    const phone = formatPhone(rawPhone);
    const guardianPhone = formatPhone(rawGuardianPhone);
    const phone4 = rawPhone.slice(-4);
    const expectedTime = formatTime(rawExpectedTime);
    const idNumber = rawIdNumber.length === 13 ? `${rawIdNumber.slice(0, 6)}-${rawIdNumber.slice(6)}` : rawIdNumber;

    const qs = '?' + getQueryString(req.body);

    // 📌 필수 입력값 유효성 검사
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

    // 📌 입력 자릿수 정밀 검사
    if (rawIdNumber.length !== 13) {
        return res.send(`<script>alert('주민등록번호는 숫자 13자리여야 합니다.'); window.location.href='/register${qs}';</script>`);
    }

    // 📌  주민등록번호 실제 존재 형식(체크섬) 검증 추가
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

    // 📌 접수 시간 계산 (한국 표준시 KST 도구 사용)
    const now = getKSTDate();
    const regDate = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;

    // 📌 저장할 신규 선수 객체 생성
    const newRow = {
        '이름': name,
        '성별': gender,
        '주민등록번호': idNumber,
        '연락처': phone,
        '연락처4': phone4,
        '참가비현황': entryFee,
        '주소': address,
        '소속클럽': club,
        '희망종목': desiredEvent,
        '예상기록': expectedTime,
        '보호자이름': guardianName,
        '보호자연락처': guardianPhone,
        '질병유무': memo,
        '기념품1': souvenir1,
        '기념품2': '',
        '홍보동의여부': marketingConsent,
        '기타': '',
        '접수날짜': regDate
    };

    // 🛡️ [동시접속 유실 방지] 대기열에 작업 추가 후 순차 처리 실행
    registerQueue.push({ newRow, idNumber, name, qs, res });
    processRegisterQueue();
});

module.exports = router;