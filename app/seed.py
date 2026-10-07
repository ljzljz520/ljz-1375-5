"""示例数据 / Demo seed data（边城：湘黔渝交界的多语地区）。"""


def seed(conn):
    # 地区（嵌套集合；茶峒为湘西州下的具体地点）----------------
    conn.executemany(
        "INSERT INTO regions(id,code,name_zh,name_en,lft,rgt,parent_id) VALUES(?,?,?,?,?,?,?)",
        [
            (1, "xiangxi", "湘西土家族苗族自治州", "Xiangxi Prefecture", 1, 10, None),
            (2, "chadong", "茶峒（边城镇）", "Chadong (Border Town)", 2, 5, 1),
            (3, "huayuan", "花垣城区", "Huayuan County Seat", 6, 9, 1),
            (4, "qiandong", "黔东南（对岸）", "Qiandongnan (opposite bank)", 11, 14, None),
        ],
    )
    conn.executemany(
        "INSERT INTO eras(id,code,name_zh,name_en,start_y,end_y) VALUES(?,?,?,?,?,?)",
        [
            (1, "qing-late", "清末", "Late Qing", 1875, 1911),
            (2, "republic", "民国", "Republican era", 1912, 1949),
            (3, "contemporary", "当代", "Contemporary", 1950, 2026),
        ],
    )
    conn.executemany(
        "INSERT INTO object_types(id,code,name_zh,name_en) VALUES(?,?,?,?)",
        [
            (1, "relic", "历史实物", "Historical relic"),
            (2, "stage", "舞台复原", "Stage reconstruction"),
            (3, "daily", "当代日常样式", "Contemporary everyday style"),
        ],
    )
    conn.executemany(
        "INSERT INTO occasions(id,code,name_zh,name_en) VALUES(?,?,?,?)",
        [
            (1, "festival", "节庆", "Festival"),
            (2, "wedding", "婚嫁", "Wedding"),
            (3, "daily", "日常劳作", "Daily work"),
            (4, "stage", "舞台展演", "Stage performance"),
        ],
    )

    # 具体来源 ---------------------------------------------------
    conn.executemany(
        """INSERT INTO sources(id,title,kind,author,citation,contact)
           VALUES(?,?,?,?,?,?)""",
        [
            (1, "《湘西苗族服饰图志》", "publication", "石启贵",
             "石启贵，1940年田野手稿整理本", "县档案馆藏副本"),
            (2, "茶峒吴奶奶口述", "fieldwork", "吴阿婆（吴金翠）",
             "2025-04-12 茶峒河街访谈，编号 CD-OH-017", "受访人留存授权书"),
            (3, "州博物馆藏品档案 M-0312", "archive", "州博物馆保管部",
             "入藏号 M-0312，1986 年征集", "curator@example.org"),
            (4, "《边城》舞台美术设计资料", "stage", "县文工团舞美组",
             "2001 版舞剧《边城》服装设计卷", "文工团资料室"),
            (5, "网络图帖（出处待核）", "publication", "佚名",
             "论坛转载，原始出处不明", None),
        ],
    )

    # 纹样 -------------------------------------------------------
    conn.executemany(
        "INSERT INTO motifs(id,slug,name_zh,name_en,visual) VALUES(?,?,?,?,?)",
        [
            (1, "cross-stitch-fish", "交叉鱼骨纹", "Crossed fish-bone motif",
             "两组折线交叉、两端带短斜刺"),
            (2, "picket-fence", "栅栏纹", "Picket-fence motif",
             "等距竖线以横线串联"),
        ],
    )

    # 展品：历史实物 / 舞台复原 / 当代日常，三种独立类型 ----------
    conn.execute(
        """INSERT INTO exhibits(id,slug,title_zh,title_en,type_id,region_id,era_id,
              year_detail,summary_zh,summary_en,has_text_grant,searchable)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,1)""",
        (1, "relic-cuffs-1910", "清末青缎袖口残件",
         "Late-Qing satin cuff fragment", 1, 2, 1, "约 1905 年",
         "青缎地，白棉线挑花，袖口边缘保留交叉鱼骨纹两道。",
         None,  # 故意缺失英文翻译，用于“翻译缺失”验收
         1),
    )
    conn.execute(
        """INSERT INTO exhibits(id,slug,title_zh,title_en,type_id,region_id,era_id,
              year_detail,summary_zh,summary_en,has_text_grant,searchable)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,1)""",
        (2, "stage-cui-cui-2001", "舞剧《边城》翠翠服装（复原）",
         "Stage costume of Cuicui (2001)", 2, 3, 3, "2001 年制",
         "舞美组依据老照片复原，袖口鱼骨纹被放大以适应远观。",
         "Reconstructed by the stage-design team from old photographs.", 1),
    )
    conn.execute(
        """INSERT INTO exhibits(id,slug,title_zh,title_en,type_id,region_id,era_id,
              year_detail,summary_zh,summary_en,has_text_grant,searchable,is_on_loan,loan_note)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,1,1,'2026-09 起借展至省博物馆三个月')""",
        (3, "daily-apron-now", "当代茶峒日常围腰",
         "Contemporary Chadong apron", 3, 2, 3, "2024 年购于边城镇集市",
         "机织围腰，鱼骨纹见于胸牌位置，搭配牛仔裤日常穿着。",
         "Machine-woven apron worn daily with jeans.", 1),
    )

    conn.executemany(
        "INSERT INTO exhibit_patterns(exhibit_id,motif_id,placement) VALUES(?,?,?)",
        [(1, 1, "袖口"), (2, 1, "袖口"), (3, 1, "胸牌"), (3, 2, "腰头")],
    )
    conn.executemany(
        "INSERT INTO exhibit_occasions(exhibit_id,occasion_id) VALUES(?,?)",
        [(1, 2), (2, 4), (3, 3), (3, 1)],
    )

    # 地区称呼：旧称改版保留（superseded_by），别名仍可被检索 ----
    conn.executemany(
        """INSERT INTO appellations(id,region_id,term_zh,term_en,phonetic,language,
              superseded_by,changed_note,changed_at)
           VALUES(?,?,?,?,?,?,?,?,?)""",
        [
            (1, 2, "挑花袖", "cross-stitch sleeve", "tiāo-huā xiù", "zh", None, None, None),
            (2, 2, "鱼骨袖", "fish-bone sleeve", "yú-gǔ xiù", "zh", 1,
             "2026 年地名与称呼普查后，规范为“挑花袖”；“鱼骨袖”为民间旧称，保留备查。",
             "2026-03-01"),
            (3, 3, "翠翠袖", "Cuicui sleeve", None, "zh", None,
             "因舞剧传播形成的县城称呼，并非乡村自称。", None),
        ],
    )
    conn.executemany(
        "INSERT INTO exhibit_appellations(exhibit_id,appellation_id) VALUES(?,?)",
        [(1, 1), (1, 2), (2, 3)],
    )

    # 陈述：同一纹样，不同语境各自独立，且保留争议 ----------------
    conn.executemany(
        """INSERT INTO statements(id,subject_type,subject_id,region_id,era_id,type_id,
              source_id,claim_zh,claim_en,confidence,dispute_with,review_note,
              status,is_searchable)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1)""",
        [
            (1, "motif", 1, 2, 1, 1, 3,
             "在茶峒清末实物上，交叉鱼骨纹位于袖口，被认为用于婚嫁礼服，寓意“成双”。",
             "On the Late-Qing Chadong relic the crossed fish-bone motif on the cuff "
             "is associated with wedding dress and the idea of a pair.",
             "resolved", None,
             "与陈述#2 并列保留：审校认为二者语境不同（实物/舞台），不予合并。",
             "approved"),
            (2, "motif", 1, 3, 3, 2, 4,
             "舞美资料显示该纹在 2001 版舞剧中仅作“水浪”装饰，服务于灯光效果，无婚俗含义。",
             None,  # 翻译缺失
             "resolved", 1,
             "审校确认：舞台符号系统独立于民俗实物，按舞台复原类型单列。",
             "approved"),
            (3, "motif", 1, 2, 3, 3, 2,
             "吴阿婆说现在围腰上的鱼骨纹主要是“好看、认得出门的人”，节庆才特别在意。",
             "Granny Wu says the motif today marks hometown recognition; its festival "
             "sense matters mainly at New Year.",
             "contested", None,
             "与早期图志的婚俗解释存在争议，暂不裁定，两说并存。",
             "approved"),
            (4, "motif", 1, None, None, None, 5,
             "网传“鱼骨纹就是鱼崇拜遗存”，无具体出处。",
             None, "contested", None,
             "审校：来源不可核，标记为争议说法，不与任何具体地区陈述合并。",
             "approved"),
            (5, "motif", 2, 2, 3, 3, 2,
             "栅栏纹在围腰腰头，口述称象征“拦在家门外的东西”，护佑日常。",
             None, "single", None, None, "approved"),
        ],
    )

    # 媒体：一条缺拍摄许可、一条无图（缺图仍保留授权文字）---------
    conn.executemany(
        """INSERT INTO media_assets(id,exhibit_id,kind,url,alt_zh,alt_en,
              has_shoot_grant,is_visible,source_id,width,height)
           VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
        [
            (1, 1, "detail", "assets/cuff-detail.svg", "袖口交叉鱼骨纹细节",
             "Crossed fish-bone detail on cuff", 1, 1, 3, 1000, 1000),
            (2, 1, "overview", "assets/cuff-overview.svg", "袖口残件全形",
             None, 0, 1, 3, 1000, 700),  # 无拍摄许可 → 图片渠道不展示
            (3, 3, "detail", None, "围腰胸牌（图像尚缺）", None, 0, 0, 2, None, None),
        ],
    )
    # 标注：原图源坐标；裁切框 200..800，热点在裁切框内/外各一
    conn.executemany(
        """INSERT INTO annotations(asset_id,motif_id,x,y,w,h,label_zh,label_en,
              crop_x,crop_y,crop_w,crop_h) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
        [
            (1, 1, 450, 480, 120, 90, "成双·婚嫁语境", "Pair / wedding reading",
             200, 200, 600, 600),
            (1, 1, 90, 500, 80, 80, "裁切线外的针脚标记", "Stitch mark outside crop",
             200, 200, 600, 600),
        ],
    )
    conn.execute(
        """INSERT INTO media_tasks(id,exhibit_id,motif_id,instruction,status)
           VALUES(1,1,1,'生成袖口交叉鱼骨纹的 4 倍放大细节图，保留针脚方向','requested')""")
    from .core import rebuild_search
    rebuild_search(conn, 1)
    conn.execute("INSERT INTO publications(version,note) VALUES(1,'初始示例数据')")
