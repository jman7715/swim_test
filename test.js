

// test.js   동시 접속 테스트 용 코드
const http = require('http');

// 동시에 3개의 가짜 요청을 날려보는 함수
function sendConcurrentRequests() {
    for (let i = 1; i <= 3; i++) {
        const data = `name=테스트${i}&gender=남자&idNumber=991231123456${i}&phone=0101234567${i}&address=서울&hasClub=no&desiredEvent=1부+5Km+(07시)&expectedTime=11030&guardianName=보호자${i}&guardianPhone=0109999888${i}&hasMedical=no&souvenir1=M+(95+~+100)&marketingConsent=받고+싶다`;

        const req = http.request({
            hostname: 'localhost',
            port: 3000, // 서버 포트에 맞게 수정 (예: 3000 또는 8080)
            path: '/register/search',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(data)
            }
        }, (res) => {
            console.log(`요청 ${i} 응답 상태 코드: ${res.statusCode}`);
        });

        req.on('error', (e) => {
            console.error(`요청 ${i} 에러 발생: ${e.message}`);
        });

        req.write(data);
        req.end();
    }
}

sendConcurrentRequests();