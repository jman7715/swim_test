const express = require('express');
const path = require('path');
const fs = require('fs'); // 📌 config.json 파일을 읽기 위해 추가된 모듈

// 📌 Supabase 클라이언트 불러오기 추가
const { createClient } = require('@supabase/supabase-js');

// 📌 Supabase 연결 정보 (프로젝트 URL과 안전한 anon 키 입력)
const supabaseUrl = 'https://wyyxcwmwuwumkkoltdoa.supabase.co';  
const supabaseKey = 'sb_publishable_98AgxVWusnJZtiEkGPe5Fw_J530lsq_';
const supabase = createClient(supabaseUrl, supabaseKey);

// 📌 공통 한국 시간(KST) 구하기 도구 함수 불러오기 (서버 타임존 문제 해결용)
const { getKSTDate } = require('./utils');

const app = express();
const PORT = process.env.PORT || 3000;

// 📌 Express 공통 미들웨어 설정 (POST 요청 데이터 파싱 및 정적 파일 제공)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// 📌 서비스 라우터 연결
const ticketModule = require('./ticket');             // 1. 참가 접수 처리 라우터
const playerCheckModule = require('./player_check');   // 2. 등록상황 조회 및 수정 처리 라우터
const adminModule = require('./admin');                // 4. 관리자 기능 라우터

// 📌 [중요] 각 라우터에 Supabase 클라이언트 주입
if (ticketModule.setSupabase) {
    ticketModule.setSupabase(supabase);
}
if (playerCheckModule.setSupabase) {
    playerCheckModule.setSupabase(supabase);
}
if (adminModule.setSupabase) {
    adminModule.setSupabase(supabase);                 // 👈 관리자 라우터 Supabase 주입 추가 완료!
}

// 라우터 경로 매핑 (객체 혹은 라우터 직접 할당 여부에 맞춤)
const ticketRouter = ticketModule.router || ticketModule;
const playerCheckRouter = playerCheckModule.router || playerCheckModule;
const adminRouter = adminModule.router || adminModule;

app.use('/register', ticketRouter);
app.use('/entry', playerCheckRouter);

// 📌 기타 라우터 연결 (배번 공지 및 관리자 기능)
const bibRouter = require('./player_bib');             // 3. 배번/레인/조 공지 연결
app.use('/bib', bibRouter);                         
app.use('/admin', adminRouter);

/**
 * 📌 날짜 객체(Date)를 'YYYY.MM.DD HH:mm' 형식의 문자열로 변환하는 헬퍼 함수
 */
function formatDateString(dateObj) {
    if (!dateObj || isNaN(dateObj)) return '';
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    const hours = String(dateObj.getHours()).padStart(2, '0');
    const minutes = String(dateObj.getMinutes()).padStart(2, '0');
    return `${year}.${month}.${day} ${hours}:${minutes}`;
}

/**
 * 📌 날짜 문자열을 자바스크립트 Date 객체로 변환하는 헬퍼 함수
 */
function parseDate(val) {
    if (!val) return null;
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
}

/**
 * 📌 swimmers.xlsx 대신 config.json 파일에서 대회 기간 및 설정 정보 읽어오는 함수
 */
function getCompetitionConfig() {
    try {
        const filePath = path.join(__dirname, 'config.json');
        
        if (!fs.existsSync(filePath)) {
            console.error("config.json 파일을 찾을 수 없습니다.");
            return null;
        }

        const fileData = fs.readFileSync(filePath, 'utf8');
        const row = JSON.parse(fileData);

        return {
            competitionName: row['competitionName'] || '아쿠아 마라톤 대회',
            competitionDate: row['competitionDate'],
            competitionCode: row['competitionCode'],
            adminAuth: row['admins'], // 관리자 배열 그대로 전달
            adminName: row['adminName'],
            adminPassword: row['adminPassword'],
            // 📌 접수 기간 설정
            regStartDate: parseDate(row['regStartDate']),
            regEndDate: parseDate(row['regEndDate']),
            // 📌 조회 및 수정 가능 기간 설정 (config.json의 checkStartDate/checkEndDate 매핑)
            updateStartDate: parseDate(row['checkStartDate']),
            updateEndDate: parseDate(row['checkEndDate']),
            // 📌 배번 및 기록 조회 기간 설정
            bibStartDate: parseDate(row['bibStartDate']),
            bibEndDate: parseDate(row['bibEndDate']),
            recordStartDate: parseDate(row['recordStartDate']),
            recordEndDate: parseDate(row['recordEndDate'])
        };
    } catch (error) {
        console.error("config.json 파일 읽기 오류:", error);
        return null;
    }
}

/**
 * 📌 메인 홈 화면 (GET /)
 * - 한국 시간(KST) 기준으로 접수/수정/배번 조회 버튼의 활성화 상태 판별
 * - 접수 시작 전일 경우 실시간 시계 및 시작 시 자동 새로고침 처리
 */
app.get('/', (req, res) => {
    const config = getCompetitionConfig() || {};
    const now = getKSTDate(); // 📌 한국 표준시(KST) 기준 현재 시간 계산

    // 📌 각 버튼별 오픈(활성화) 조건 계산
    const isRegOpen = config.regStartDate && config.regEndDate && (now >= config.regStartDate && now <= config.regEndDate);
    const isUpdateOpen = config.updateStartDate && config.updateEndDate && (now >= config.updateStartDate && now <= config.updateEndDate);
    const isBibOpen = config.bibStartDate && config.bibEndDate && (now >= config.bibStartDate && now <= config.bibEndDate);

    // 📌 접수 시작 전일 때만 화면에 실시간 시계 표시
    const showClock = config.regStartDate && (now < config.regStartDate);

    // 📌 자바스크립트 자동 새로고침 기준 타임스탬프
    const regStartTime = config.regStartDate ? config.regStartDate.getTime() : null;

    // 📌 화면 중앙의 접수 상태 안내 문구 및 색상 결정
    let regStatusText = '접수 기간이 아닙니다';
    let regStatusColor = '#dc3545'; // 기본 빨간색

    if (isRegOpen) {
        regStatusText = '접수 진행 중입니다';
        regStatusColor = '#28a745'; // 초록색
    } else if (config.regStartDate && now < config.regStartDate) {
        const formattedDate = formatDateString(config.regStartDate);
        regStatusText = `${formattedDate}부터 <br> 접수를 시작합니다.`;
        regStatusColor = '#eb7405'; // 주황색
    } else if (config.regEndDate && now > config.regEndDate) {
        regStatusText = '관리자의 확인이 필요 합니다..';
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
                <!-- 접수 시작 전 타이머 영역 -->
                <div id="live-clock" style="font-size: 25px; font-weight: bold; color: #333; margin-bottom: 15px;"></div>
                ` : ''}

                <!-- 접수 상태 및 시작 안내 영역 -->
                <div class="period-info">
                    <span style="color: ${regStatusColor}; font-size: 22px; font-weight: bold;">
                         ${regStatusText} 
                    </span>
                </div>

                <!-- 1. 참가 접수 버튼 -->
                <a href="/register" class="menu-btn ${isRegOpen ? '' : 'disabled'}">
                    1. 참가 접수하기
                </a>

                <!-- 2. 등록상황 확인 및 수정 버튼 -->
                <a href="/entry" class="menu-btn ${isUpdateOpen ? '' : 'disabled'}">
                    2. 등록상황 확인 및 수정
                </a>

                <!-- 3. 배번 공지 확인 버튼 -->
                <a href="/bib" class="menu-btn ${isBibOpen ? '' : 'disabled'}">
                    3. 배번(레인/조) 공지 확인
                </a>

                <div class="admin-link">
                    <a href="/admin">관리자 로그인</a>
                </div>
            </div>

            ${showClock ? `
            <!-- 실시간 시계 업데이트 및 오픈 시 자동 페이지 새로고침 스크립트 -->
            <script>
                const targetRegTime = ${regStartTime};

                function updateClock() {
                    const now = new Date();

                    // 접수 시작 시간이 경과되면 화면 자동 새로고침(버튼 활성화)
                    if (targetRegTime && now.getTime() >= targetRegTime) {
                        location.reload();
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

// 📌 포트 대기 실행
app.listen(PORT, () => {
    console.log(`메인 서버가 실행되었습니다: http://localhost:${PORT}`);
});

