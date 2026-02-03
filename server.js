const express = require('express');
const multer = require('multer');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const app = express();

// Khởi tạo thư mục và file dữ liệu
if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');
const DATA_FILE = './data.json';

// Hàm đọc dữ liệu (Cấu trúc mới: { meetings: { "id1": {...}, "id2": {...} } })
const readData = () => {
    if (!fs.existsSync(DATA_FILE)) return { meetings: {} };
    try {
        const content = fs.readFileSync(DATA_FILE, 'utf8');
        return JSON.parse(content);
    } catch (e) {
        return { meetings: {} };
    }
};
const saveData = (data) => fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cấu hình Session
app.use(session({
    secret: 'nas-secret-key-123',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 3600000 }
}));

// Middleware bảo vệ Admin
const auth = (req, res, next) => {
    if (req.session && req.session.isAdmin) {
        next(); // Cho phép đi tiếp
    } else {
        res.status(403).json({ error: 'Unauthorized' }); // Chặn lại
    }
};

// --- CÁC ROUTE GIAO DIỆN ---

// Chuyển hướng link mời họp (Vd: /meeting/abc123) sang trang index
app.get('/meeting/:id', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.get('/admin.html', (req, res) => {
    if (req.session && req.session.isAdmin) {
        res.sendFile(path.join(__dirname, 'public/admin.html'));
    } else {
        res.redirect('/login.html');
    }
});

// Xem PDF trực tiếp
app.get('/view-pdf/:filename', (req, res) => {
    const filePath = path.join(__dirname, 'uploads', req.params.filename);
    if (fs.existsSync(filePath)) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline');
        fs.createReadStream(filePath).pipe(res);
    } else {
        res.status(404).send('Không tìm thấy tài liệu!');
    }
});

// --- CÁC API HỆ THỐNG ---

// --- API ĐĂNG NHẬP ---
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    // Bạn có thể đổi 'admin123' thành mật khẩu bạn muốn
    if (password === 'admin123') {
        req.session.isAdmin = true;
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: "Sai mật khẩu!" });
    }
});

// --- API ĐĂNG XUẤT ---
app.get('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ success: false });
        }
        res.clearCookie('connect.sid'); // Xóa cookie phiên làm việc
        res.json({ success: true });
    });
});

// --- KIỂM TRA TRẠNG THÁI ĐĂNG NHẬP (Dùng cho Admin.html) ---
app.get('/api/auth-check', (req, res) => {
    if (req.session && req.session.isAdmin) {
        res.json({ loggedIn: true });
    } else {
        res.json({ loggedIn: false });
    }
});

// 1. API Tạo cuộc họp mới (Sinh ID ngẫu nhiên)
app.post('/api/create-meeting', auth, (req, res) => {
    let data = readData();
    const newID = Math.random().toString(36).substring(2, 8); // Tạo mã 6 ký tự ngẫu nhiên
    data.meetings[newID] = {
        title: "Cuộc họp mới",
        time: "",
        members: "",
        location: "",
        files: []
    };
    saveData(data);
    res.json({ success: true, id: newID });
});

// 2. API lấy dữ liệu theo ID (Dùng cho trang chủ khi truy cập link mời)
app.get('/api/data/:id', (req, res) => {
    const data = readData();
    const meeting = data.meetings[req.params.id];
    if (meeting) res.json(meeting);
    else res.status(404).json({ error: "Không tìm thấy cuộc họp" });
});

// 3. API cập nhật thông tin theo ID
app.post('/api/update-info/:id', auth, (req, res) => {
    const { id } = req.params;
    let data = readData();
    if (data.meetings[id]) {
        Object.assign(data.meetings[id], req.body);
        saveData(data);
        res.json({ success: true });
    } else res.status(404).json({ error: "ID không tồn tại" });
});

// 4. API Upload file theo ID
const upload = multer({ dest: 'uploads/' });
app.post('/api/upload/:id', auth, upload.single('file'), (req, res) => {
    const { id } = req.params;
    let data = readData();
    if (data.meetings[id]) {
        const fileInfo = {
            name: req.body.displayName || req.file.originalname,
            path: `/view-pdf/${req.file.filename}`, // Dùng route xem trực tiếp
            category: req.body.category,
            realPath: req.file.filename // Lưu để phục vụ việc xóa
        };
        data.meetings[id].files.push(fileInfo);
        saveData(data);
        res.json({ success: true });
    } else res.status(404).json({ error: "ID không tồn tại" });
});

// 5. API Xóa file theo ID
app.delete('/api/meeting/:id', auth, (req, res) => {
    try {
        const { id } = req.params;
        let data = readData();
        
        if (data.meetings[id]) {
            // Xóa các file vật lý liên quan trước khi xóa dữ liệu chữ
            data.meetings[id].files.forEach(file => {
                const filePath = path.join(__dirname, 'uploads', file.realPath);
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            });

            delete data.meetings[id]; // Xóa ID cuộc họp khỏi object
            saveData(data); // Lưu lại vào data.json
            res.json({ success: true });
        } else {
            res.status(404).json({ error: "ID không tồn tại" });
        }
    } catch (err) {
        res.status(500).json({ error: "Lỗi khi xóa dữ liệu" });
    }
});

app.post('/api/delete-file/:id', auth, (req, res) => {
    const { id } = req.params;
    const { fileName } = req.body; // Đây là realPath (tên file gốc trên server)
    let data = readData();

    if (data.meetings[id]) {
        // 1. Xác định đường dẫn tuyệt đối đến file
        const absolutePath = path.join(__dirname, 'uploads', fileName);
        
        // 2. Xóa file vật lý trên ổ đĩa
        if (fs.existsSync(absolutePath)) {
            try {
                fs.unlinkSync(absolutePath);
                console.log(`Đã xóa file: ${absolutePath}`);
            } catch (err) {
                console.error("Lỗi khi xóa file vật lý:", err);
            }
        }

        // 3. Xóa thông tin file trong data.json
        // Dùng realPath để lọc chính xác file cần xóa
        data.meetings[id].files = data.meetings[id].files.filter(f => f.realPath !== fileName);
        
        saveData(data);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "Không tìm thấy cuộc họp" });
    }
});

app.use(express.static('public'));

// API lấy toàn bộ danh sách cuộc họp từ file data.json
app.get('/api/meetings', auth, (req, res) => {
    try {
        const data = readData(); // Hàm này bạn đã có trong server.js
        // Chuyển object meetings thành một mảng để frontend dễ hiển thị
        const meetingList = Object.keys(data.meetings).map(id => {
            return {
                meetingId: id,
                ...data.meetings[id]
            };
        });
        res.json(meetingList);
    } catch (err) {
        res.status(500).json({ error: "Không thể đọc dữ liệu file" });
    }
});

app.listen(3000, '0.0.0.0', () => console.log('Server is running at http://localhost:3000'));