const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();

// 📌 Supabase 클라이언트 연결 설정
const supabase = require('./supabase');


// 시간 수치/문자열 값을 HH:mm 형식으로 변환하는 함수
function formatTimeString(timeVal) {
    if (!timeVal) return '';
    const str = String(timeVal).trim();
    if (str.includes(':')) return str;
    
    const num = Number(str);
    if (!isNaN(num) && num < 1) {
        const totalMinutes = Math.round(num * 24 * 60);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }
    return str;
}

// 메인 입력 화면 (GET /bib) -> 라우터이므로 여기서는 루트('/')
router.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="ko">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>2026 아쿠아 마라톤 배번확인</title>
            <link rel="stylesheet" href="/style.css">
        </head>
        <body>
            <div class="container">
                <h2>2026 아쿠아 마라톤 배번확인</h2>
                <form action="/bib/search" method="POST">
                    <div class="form-group">
                        <label for="name">선수 이름</label>
                        <input type="text" id="name" name="name" required placeholder="이름을 입력하세요">
                    </div>
                    <div class="form-group">
                        <label for="phone4">전화번호 뒤 4자리</label>
                        <input type="text" id="phone4" name="phone4" required maxlength="4" placeholder="뒤 4자리 입력" inputmode="numeric">
                    </div>
                    <button type="submit">조회하기</button>
                </form>
                <a href="/" style="display:block; text-align:center; margin-top:20px; text-decoration:none; background-color:#6c757d; color:white; height:75px; line-height:75px; border-radius:10px; font-size:26px; font-weight:bold;">메인으로 돌아가기</a>
            </div>
        </body>
        </html>
    `);
});

// 검색 결과 처리 화면 (POST /bib/search)
router.post('/search', async (req, res) => {
    const inputName = (req.body.name || '').trim();
    const inputPhone4 = (req.body.phone4 || '').trim().padStart(4, '0');

    try {
        // 📌 수파베이스 swimmers 테이블에서 전체 데이터 조회
        const { data: dataRows, error: fetchError } = await supabase
            .from('swimmers')
            .select('*');

        if (fetchError) {
            console.error("수파베이스 데이터 조회 오류:", fetchError);
            throw fetchError;
        }

        const rows = dataRows || [];

        // 이름과 전화번호 뒤 4자리가 일치하는 행 찾기
        const foundRow = rows.find(row => {
            const rowName = String(row['name'] || '').trim(); 
            const rawPhone = String(row['phone4'] || row['phone'] || '').trim(); 
            const rowPhone4 = rawPhone.slice(-4).padStart(4, '0');

            return rowName === inputName && rowPhone4 === inputPhone4;
        });

        let resultHtml = '';
        if (foundRow) {
            const name = foundRow['name'] || '';            // 이름
            const gender = foundRow['gender'] || '';          // 성별
            
            // 종목: 숫자인 경우 천단위 콤마 및 'm' 추가 (예: 5000 -> 5,000m)
            let game = foundRow['game'] || foundRow['desired_event'] || '';
            if (!isNaN(game) && game !== '') {
                game = Number(game).toLocaleString() + 'm';
            }

            const matchNo = foundRow['match_no'] || '';    // 경기번호
            const lane_no = foundRow['lane_no'] || '';          // 레인번호
            const bNo = foundRow['bib_no'] || '';          // 등번호
            const standbyTime = formatTimeString(foundRow['checkin_time']); // 등록시간
            const startTime = formatTimeString(foundRow['entry_time']);   // 경기시간
            const notes = foundRow['notes'] || '';          // 기타사항

            resultHtml = `
                <div class="result-box">
                    <h3>[ 선수 정보 ]</h3>
                    <p><strong>이름 :</strong> ${name}</p>
                    <p><strong>성별 :</strong> ${gender}</p>
                    <p><strong>종목 :</strong> ${game}</p>
                    <p><strong>경기번호 :</strong> ${matchNo ? '제 ' + matchNo + ' 경기' : '미배정'}</p>
                    <p><strong>레인번호 :</strong> ${lane_no ? '제 ' + lane_no + ' 레인' : '미배정'}</p>
                    <p><strong>등번호 :</strong> ${bNo || '미배정'}</p>
                    <p><strong>등록시간 :</strong> ${standbyTime}</p>
                    <p><strong>경기시간 :</strong> ${startTime}</p>
                    <p><strong>기타사항 :</strong> ${notes}</p>
                </div>
            `;
        } else {
            resultHtml = `
                <div class="error-box" style="color: red; margin-bottom: 20px; font-weight: bold;">
                    <p>일치하는 선수 정보를 찾을 수 없습니다.<br>이름과 전화번호 뒤 4자리를 다시 확인해주세요.</p>
                </div>
            `;
        }

        // notice_bib.txt 파일 읽어오기
        let noticeText = "등록된 공지사항이 없습니다.";
        try {
            if (fs.existsSync('notice_bib.txt')) {
                noticeText = fs.readFileSync('notice_bib.txt', 'utf8').replace(/\n/g, '<br>');
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
                <title>수영대회 대진 확인 결과</title>
                <link rel="stylesheet" href="/style.css">
            </head>
            <body>
                <div class="container">
                    <h2>2026 아쿠아 마라톤 배번확인</h2>
                    ${resultHtml}
                    
                    <div class="notice">
                        <h3>[ 공지사항 ]</h3>
                        <p>${noticeText}</p>
                    </div>

                    <div class="images">
                        <h3>[ 안내 이미지 ]</h3>
                        
                        <!-- PC 전용 이미지 (모바일에서는 숨김) -->
                        <img src="/info_100.jpg" alt="안내 이미지 1" class="pc-only" onerror="this.style.display='none'">
                        <img src="/info_300.jpg" alt="안내 이미지 3" class="pc-only" onerror="this.style.display='none'">

                        <!-- 모바일 전용 이미지 (PC에서는 숨김) -->
                        <img src="/info_101.jpg" alt="안내 이미지 1" class="mobile-only" onerror="this.style.display='none'">
                        <img src="/info_301.jpg" alt="안내 이미지 3" class="mobile-only" onerror="this.style.display='none'">
                    </div>
                    </div>

                    <a href="/bib" class="back-btn" style="display:block; text-align:center; margin-top:20px; text-decoration:none; background-color:#6c757d; color:white; height:75px; line-height:75px; border-radius:10px; font-size:26px; font-weight:bold;">돌아가기</a>
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
                <a href="/bib">돌아가기</a>
            </div>
        `);
    }
});

module.exports = router;

