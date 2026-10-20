const express = require('express');
const path = require('path');
const xlsx = require('xlsx');

const app = express();
const PORT = process.env.PORT || 3000;

// 공통 미들웨어 설정
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// 라우터 연결
const ticketRouter = require('./ticket');           // 1. 참가 접수
const playerCheckRouter = require('./player_check');   // 2. 조회 및 수정

app.use('/register', ticketRouter);
app.use('/entry', playerCheckRouter);

// 추후 구현할 라우터들
const bibRouter = require('./player_bib');      // 배번공지 연결
app.use('/bib', bibRouter);                     // 배번공지 연결
const adminRouter = require('./admin');        // 관리자 로그인
app.use('/admin', adminRouter);                // 관리자 로그인

// 날짜를 보기 좋게 포맷팅하는 함수 (예: 2026.10.22 13:00)
function formatDateString(dateObj) {
    if (!dateObj || isNaN(dateObj)) return '';
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    const hours = String(dateObj.getHours()).padStart(2, '0');
    const minutes = String(dateObj.getMinutes()).padStart(2, '0');
    return `${year}.${month}.${day} ${hours}:${minutes}`;
}

// 엑셀 파일에서 대회 설정 정보를 읽어오는 함수
function getCompetitionConfig() {
    try {
        const filePath = path.join(__dirname, 'swimmers.xlsx');
        const workbook = xlsx.readFile(filePath);
        const sheet = workbook.Sheets['대회정보'];
        
        if (!sheet) {
            console.error("'대회정보' 시트를 찾을 수 없습니다.");
            return null;
        }

        const data = xlsx.utils.sheet_to_json(sheet);
        if (data.length === 0) {
            console.error("'대회정보' 시트에 데이터가 없습니다.");
            return null;
        }

        const row = data[0]; // 첫 번째 행의 데이터 사용

        return {
            competitionName: row['대회명'] || '아쿠아 마라톤 대회',
            competitionDate: row['대회날짜'],
            competitionCode: row['대회코드'],
            adminAuth: row['관리자권한'],
            adminName: row['관리자이름'],
            adminPassword: row['관리자비번'],
            regStartDate: row['접수날짜'] ? new Date(row['접수날짜']) : null,
            regEndDate: row['접수종료날짜'] ? new Date(row['접수종료날짜']) : null,
            updateStartDate: row['수정날짜'] ? new Date(row['수정날짜']) : null,
            updateEndDate: row['수정종료날짜'] ? new Date(row['수정종료날짜']) : null,
            bibStartDate: row['배번공지날짜'] ? new Date(row['배번공지날짜']) : null,
            bibEndDate: row['배번공지종료날짜'] ? new Date(row['배번공지종료날짜']) : null,
            recordStartDate: row['기록조회날짜'] ? new Date(row['기록조회날짜']) : null,
            recordEndDate: row['기록조회종료날짜'] ? new Date(row['기록조회종료날짜']) : null
        };
    } catch (error) {
        console.error("엑셀 파일 읽기 오류:", error);
        return null;
    }
}

// 메인 홈 화면 (접수 상태 안내 문구 + 조건부 실시간 시계 + 자동 새로고침)
app.get('/', (req, res) => {
    const config = getCompetitionConfig() || {};
    const now = new Date(); // 현재 시간

    // 각 버튼별 활성화 조건 계산
    const isRegOpen = config.regStartDate && config.regEndDate && (now >= config.regStartDate && now <= config.regEndDate);
    const isUpdateOpen = config.updateStartDate && config.updateEndDate && (now >= config.updateStartDate && now <= config.updateEndDate);
    const isBibOpen = config.bibStartDate && config.bibEndDate && (now >= config.bibStartDate && now <= config.bibEndDate);

    // 시계 표시 조건: 접수 시작일 설정이 있고, 현재 시간이 접수 시작일 이전일 때만 표시
    const showClock = config.regStartDate && (now < config.regStartDate);

    // 접수 시작 타임스탬프 (자바스크립트 자동 새로고침용)
    const regStartTime = config.regStartDate ? config.regStartDate.getTime() : null;

    // 접수 상태 안내 문구 결정 로직 (대괄호 포함)
    let regStatusText = '접수 기간이 아닙니다';
    let regStatusColor = '#dc3545'; // 기본 빨간색

    if (isRegOpen) {
        regStatusText = '접수 진행 중입니다';
        regStatusColor = '#28a745'; // 초록색
    } else if (config.regStartDate && now < config.regStartDate) {
        // 접수 시작 전일 때
        const formattedDate = formatDateString(config.regStartDate);
        regStatusText = `${formattedDate}부터 <br> 접수를 시작합니다.`;
        regStatusColor = '#eb7405'; // 파란색 (안내 강조)
    } else if (config.regEndDate && now > config.regEndDate) {
        // 접수 마감 후일 때
        regStatusText = '접수가 마감되었습니다.';
        regStatusColor = '#6c757d'; // 회색
    }

    const compName = config.competitionName || '2026 아쿠아 마라톤 대회';

    res.send(`
        <!DOCTYPE html>
        <html lang="ko">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${compName}</title>
            <link rel="stylesheet" href="/style.css">
            <style>
                .home-container {
                    max-width: 600px;
                    margin: 50px auto;
                    background: white;
                    padding: 40px 20px;
                    border-radius: 12px;
                    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.08);
                    text-align: center;
                }
                .menu-btn {
                    display: block;
                    width: 100%;
                    height: 75px;
                    line-height: 75px;
                    background-color: #007BFF;
                    color: white;
                    text-decoration: none;
                    border-radius: 10px;
                    font-size: 26px;
                    font-weight: bold;
                    margin-bottom: 20px;
                    box-sizing: border-box;
                }
                .menu-btn:active {
                    background-color: #0056b3;
                }
                .menu-btn.disabled {
                    background-color: #ccc;
                    color: #666;
                    cursor: not-allowed;
                    pointer-events: none;
                }
                .period-info {
                    margin-bottom: 30px;
                    font-size: 18px;
                    color: #555374;
                    background: #f8f9fa;
                    padding: 15px;
                    border-radius: 8px;
                }
                .admin-link {
                    margin-top: 40px;
                    font-size: 16px;
                }
                .admin-link a {
                    color: #6c757d;
                    text-decoration: none;
                }
                .admin-link a:hover {
                    text-decoration: underline;
                }
            </style>
        </head>
        <body>
            <div class="home-container">
                <h2>${compName}</h2>
                
                ${showClock ? `
                <!-- 접수 시작 이전일 때만 표시되는 실시간 시계 영역 -->
                <div id="live-clock" style="font-size: 25px; font-weight: bold; color: #333; margin-bottom: 15px;"></div>
                ` : ''}

                 <!-- 접수 시작 이전일 때만 표시되는 안내 문구 영역 -->
                <div class="period-info">
                    <span style="color: ${regStatusColor}; font-size: 22px; font-weight: bold;">
                         ${regStatusText} 
                    </span>
                </div>

                <a href="/register" class="menu-btn ${isRegOpen ? '' : 'disabled'}">
                    1. 참가 접수하기
                </a>

                <a href="/entry" class="menu-btn ${isUpdateOpen ? '' : 'disabled'}">
                    2. 등록상황 확인 및 수정
                </a>

                <a href="/bib" class="menu-btn ${isBibOpen ? '' : 'disabled'}">
                    3. 배번(레인/조) 공지 확인
                </a>

                <div class="admin-link">
                    <a href="/admin">관리자 로그인</a>
                </div>
            </div>

            ${showClock ? `
            <!-- 실시간 시계 및 자동 새로고침 스크립트 -->
            <script>
                const targetRegTime = ${regStartTime};

                function updateClock() {
                    const now = new Date();

                    // 접수 시작 시간이 되었는지 실시간 체크
                    if (targetRegTime && now.getTime() >= targetRegTime) {
                        location.reload(); // 시간이 되면 자동 새로고침
                        return;
                    }

                    const year = now.getFullYear();
                    const month = String(now.getMonth() + 1).padStart(2, '0');
                    const day = String(now.getDate()).padStart(2, '0');
                    const hours = String(now.getHours()).padStart(2, '0');
                    const minutes = String(now.getMinutes()).padStart(2, '0');
                    const seconds = String(now.getSeconds()).padStart(2, '0');

                    const timeString = year + '년 ' + month + '월 ' + day + '일 ' + hours + ':' + minutes + ':' + seconds;
                    const clockElement = document.getElementById('live-clock');
                    if (clockElement) {
                        clockElement.innerText = timeString;
                    }
                }

                setInterval(updateClock, 1000);
                updateClock();
            </script>
            ` : ''}
        </body>
        </html>
    `);
});

app.listen(PORT, () => {
    console.log(`메인 서버가 실행되었습니다: http://localhost:${PORT}`);
});